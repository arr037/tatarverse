/**
 * Браузерная часть работы с API каталога (api.tatarverse.cc): настройки формы, карточка центра, заявки,
 * «Мои заявки» и капча Google. Адрес API — config.api.url. Ключи заявок хранятся только здесь, в браузере
 * (localStorage): по ним человек видит свои заявки, исправляет и отзывает их. Описание API —
 * https://api.tatarverse.cc/docs/.
 */
import { config } from "@/config";

export const API = config.api.url;

/** Текст по языкам: { "ru": { "text": "…" } }. */
export type Texts = Record<string, { text?: string | null } | null> | null;
export type Lists = Record<string, { items?: string[] | null } | null> | null;

export interface CodeLabel {
	code: string;
	ru: string;
	en: string;
}

export interface CatalogConfig {
	captcha: { provider: string | null; siteKey: string | null };
	submissionsOpen: boolean;
	languages: string[];
	categories: CodeLabel[];
	roles: CodeLabel[];
	federalDistricts: string[];
	countries: Array<{ code: string; ru: string; en: string; flag: string | null; macro: string }>;
	limits: Record<string, number>;
	logos: { enabled: boolean; maxBytes: number };
	submissionTokenHeader: string;
}

/** Карточка центра — как GET /centers/{code}. */
export interface CenterCard {
	id: string;
	name: Texts;
	summary: Texts;
	about: Texts;
	categoryCode: string;
	online: boolean;
	location: {
		countryCode?: string | null;
		region?: Texts;
		district?: Texts;
		city?: Texts;
		federalDistrict?: string | null;
	} | null;
	address: string | null;
	coordinates: { lat: number; lon: number } | null;
	links: Array<{ url: string; kind?: string | null }>;
	leader: string | null;
	phones: string[];
	emails: string[];
	features: Lists;
	facts: Array<{ label: string; value: string }>;
	sources: Array<{ url: string; title?: string | null }>;
	logo: { thumb: string; full: string } | null;
	version: number;
}

/** Поля центра в заявке (CenterFields API). */
export interface CenterFields {
	name?: Texts;
	summary?: Texts;
	about?: Texts;
	category?: string | null;
	online?: boolean;
	country?: string | null;
	region?: Texts;
	district?: Texts;
	city?: Texts;
	federalDistrict?: string | null;
	address?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	links?: Array<{ url: string }> | null;
	leader?: string | null;
	phones?: string[] | null;
	emails?: string[] | null;
	features?: Lists;
	facts?: Array<{ label: string; value: string }> | null;
	sources?: Array<{ url: string; title?: string | null }> | null;
}

export interface SubmissionView {
	id: number;
	kind: "create" | "edit";
	status: "pending" | "approved" | "rejected" | "withdrawn";
	name: Texts;
	center: string | null;
	centerUrl: string | null;
	changedFields: string[];
	createdAt: string;
	updatedAt: string;
	decidedAt: string | null;
	reason: string | null;
	logo: string | null;
}

/** Ошибка API: ProblemDetails с errorCode и полями. */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		readonly detail: string | null,
		readonly fields: Record<string, string> = {},
	) {
		super(detail ?? code);
	}
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`${API}${path}`, {
			...init,
			headers: {
				Accept: "application/json",
				...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
				...init.headers,
			},
		});
	} catch {
		throw new ApiError(0, "network", null);
	}
	if (response.status === 204) return undefined as T;
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		throw new ApiError(response.status, body?.errorCode ?? String(response.status), body?.detail ?? null, body?.fields ?? {});
	}
	return body as T;
}

/** Текст поля из объекта по языкам: API отдаёт выбранный язык, а без перевода — запасной. */
export function textOf(value: Texts | undefined): string {
	for (const item of Object.values(value ?? {})) {
		const text = item?.text?.trim();
		if (text) return text;
	}
	return "";
}

export function itemsOf(value: Lists | undefined): string[] {
	for (const item of Object.values(value ?? {})) {
		if (item?.items?.length) return item.items;
	}
	return [];
}

// ── Ключи заявок на этом устройстве ─────────────────────────────────────────

export interface SavedSubmission {
	id: number;
	token: string;
	title: string;
	createdAt: string;
}

const STORE = "tatarverse.submissions";

export function savedSubmissions(): SavedSubmission[] {
	try {
		const list = JSON.parse(localStorage.getItem(STORE) ?? "[]");
		return Array.isArray(list) ? list.filter((x) => x && typeof x.token === "string") : [];
	} catch {
		return [];
	}
}

export function saveSubmission(entry: SavedSubmission) {
	const list = savedSubmissions().filter((x) => x.id !== entry.id);
	localStorage.setItem(STORE, JSON.stringify([entry, ...list].slice(0, 50)));
}

export function forgetSubmission(id: number) {
	localStorage.setItem(STORE, JSON.stringify(savedSubmissions().filter((x) => x.id !== id)));
}

// ── Капча Google reCAPTCHA v2 (невидимая) ───────────────────────────────────

interface Grecaptcha {
	render(container: HTMLElement, options: Record<string, unknown>): number;
	execute(widget: number): void;
	reset(widget: number): void;
}

declare global {
	interface Window {
		grecaptcha?: Grecaptcha;
		__tvCaptchaReady?: () => void;
	}
}

let captchaScript: Promise<Grecaptcha> | null = null;

function loadCaptcha(lang: string): Promise<Grecaptcha> {
	captchaScript ??= new Promise((resolve, reject) => {
		window.__tvCaptchaReady = () => (window.grecaptcha ? resolve(window.grecaptcha) : reject(new Error("captcha")));
		const script = document.createElement("script");
		script.src = `https://www.recaptcha.net/recaptcha/api.js?onload=__tvCaptchaReady&render=explicit&hl=${encodeURIComponent(lang)}`;
		script.async = true;
		script.onerror = () => reject(new Error("captcha"));
		document.head.append(script);
	});
	return captchaScript;
}

/**
 * Невидимая капча: токен на каждую отправку — новый. Капча выключена на сервере (provider = null) — токена не нужно.
 */
export async function createCaptcha(config: CatalogConfig, container: HTMLElement, lang: string) {
	if (config.captcha.provider !== "recaptcha" || !config.captcha.siteKey) {
		return { token: async () => null as string | null, reset: () => {} };
	}
	const grecaptcha = await loadCaptcha(lang);
	let pending: ((token: string | null) => void) | null = null;
	const widget = grecaptcha.render(container, {
		sitekey: config.captcha.siteKey,
		size: "invisible",
		callback: (token: string) => pending?.(token),
		"expired-callback": () => pending?.(null),
		"error-callback": () => pending?.(null),
	});
	return {
		token: () =>
			new Promise<string | null>((resolve) => {
				pending = resolve;
				grecaptcha.execute(widget);
			}),
		reset: () => grecaptcha.reset(widget),
	};
}
