/**
 * Форма «Добавить центр» / «Предложить правку» (src/components/submit/SubmitForm.astro) поверх API каталога.
 *
 * Новый центр — POST /submissions. Правка (?code=tbk-N) — POST /centers/{code}/submissions: форма заполнена нынешней
 * карточкой, простые поля (ссылки, телефоны, страна…) уходят целиком, а тексты по языкам — только изменённые и
 * только под языком страницы: остальные языки карточки сервер не трогает. Ключ заявки сохраняется в браузере —
 * по нему «Мои заявки».
 */
import {
	api,
	ApiError,
	type CatalogConfig,
	type CenterCard,
	type CenterFields,
	createCaptcha,
	itemsOf,
	saveSubmission,
	textOf,
	type Texts,
} from "@/lib/client/catalogApi";

type Messages = Record<string, string>;

const LOCALIZED = ["name", "summary", "about", "region", "district", "city"] as const;

/** Ключ ошибки API → поле формы: name.ru → name, links[2] → links, submitter.contact → submitterContact. */
function fieldOf(key: string): string {
	if (key === "submitter.role") return "role";
	if (key.startsWith("submitter.")) {
		const rest = key.slice("submitter.".length);
		return `submitter${rest[0]?.toUpperCase() ?? ""}${rest.slice(1)}`;
	}
	return key.split(/[.[]/, 1)[0] ?? key;
}

const lines = (value: string) =>
	value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

export function initSubmitForm() {
	const root = document.querySelector<HTMLElement>("[data-submit-root]");
	if (!root) return;
	const form = root.querySelector<HTMLFormElement>("[data-submit-form]")!;
	const status = root.querySelector<HTMLElement>("[data-submit-status]")!;
	const errorBox = root.querySelector<HTMLElement>("[data-submit-errors]")!;
	const button = root.querySelector<HTMLButtonElement>("[data-submit-button]")!;
	const messages = JSON.parse(root.dataset.messages ?? "{}") as Messages;
	const lang = root.dataset.locale ?? "ru";
	const code = new URLSearchParams(location.search).get("code")?.trim() || null;
	const t = (key: string, vars: Record<string, string | number> = {}) =>
		(messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));

	const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
	const value = (name: string) => field(name)?.value.trim() ?? "";

	let config: CatalogConfig;
	let card: CenterCard | null = null;
	let plain: CenterCard | null = null;
	let captcha: Awaited<ReturnType<typeof createCaptcha>>;
	const original: Record<string, string> = {};

	const show = (text: string) => {
		status.textContent = text;
		status.hidden = false;
	};

	function fillOptions() {
		const ru = lang === "ru";
		const category = form.querySelector<HTMLSelectElement>('[data-options="categories"]')!;
		for (const c of config.categories) category.append(new Option(ru ? c.ru : c.en, c.code));
		const country = form.querySelector<HTMLSelectElement>('[data-options="countries"]')!;
		const collator = new Intl.Collator(lang);
		for (const c of [...config.countries].sort((a, b) => collator.compare(ru ? a.ru : a.en, ru ? b.ru : b.en))) {
			country.append(new Option(`${c.flag ? `${c.flag} ` : ""}${ru ? c.ru : c.en}`, c.code));
		}
		const districts = form.querySelector<HTMLSelectElement>('[data-options="federalDistricts"]')!;
		for (const d of config.federalDistricts) districts.append(new Option(d, d));
		const roles = form.querySelector<HTMLElement>('[data-options="roles"]')!;
		for (const r of config.roles) {
			const label = document.createElement("label");
			label.className = "flex items-center gap-2";
			const radio = Object.assign(document.createElement("input"), { type: "radio", name: "role", value: r.code, className: "size-4" });
			label.append(radio, ru ? r.ru : r.en);
			roles.append(label);
		}
		const logoLabel = form.querySelector<HTMLElement>("[data-logo-label]")!;
		logoLabel.textContent = (logoLabel.dataset.template ?? "").replace("{size}", String(Math.round(config.logos.maxBytes / 1024 / 1024)));
		if (!config.logos.enabled) form.querySelector<HTMLElement>("[data-logo]")!.hidden = true;
		toggleRussia();
	}

	function toggleRussia() {
		const russia = value("country") === "RU";
		form.querySelector<HTMLElement>("[data-only-russia]")!.hidden = !russia;
	}

	function prefill() {
		if (!card || !plain) return;
		const set = (name: string, text: string) => {
			const el = field(name);
			if (el) el.value = text;
			original[name] = text;
		};
		set("name", textOf(card.name));
		set("summary", textOf(card.summary));
		set("about", textOf(card.about));
		set("region", textOf(card.location?.region));
		set("district", textOf(card.location?.district));
		set("city", textOf(card.location?.city));
		set("features", itemsOf(card.features).join("\n"));
		set("category", plain.categoryCode);
		(field("online") as HTMLInputElement).checked = plain.online;
		set("country", plain.location?.countryCode ?? "");
		set("federalDistrict", plain.location?.federalDistrict ?? "");
		set("address", plain.address ?? "");
		set("links", plain.links.map((l) => l.url).join("\n"));
		set("leader", plain.leader ?? "");
		set("phones", plain.phones.join("\n"));
		set("emails", plain.emails.join("\n"));
		set("sources", plain.sources.map((s) => s.url).join("\n"));
		if (plain.logo) {
			const img = form.querySelector<HTMLImageElement>("[data-logo-current]")!;
			img.src = plain.logo.thumb;
			img.hidden = false;
			form.querySelector<HTMLElement>("[data-remove-logo]")!.hidden = false;
		}
		toggleRussia();
	}

	/** Текст по языку страницы: у правки — только если его поменяли (null — языки карточки не трогать). */
	function localized(name: (typeof LOCALIZED)[number]): Texts {
		const text = value(name);
		if (card && text === (original[name] ?? "")) return null;
		if (!card && !text) return null;
		return { [lang]: { text } };
	}

	function centerFields(): CenterFields {
		const country = value("country") || null;
		const sources = lines(value("sources"));
		const titles = new Map((plain?.sources ?? []).map((s) => [s.url, s.title ?? null]));
		const features = lines(value("features"));
		const featuresChanged = !card || value("features") !== (original.features ?? "");
		return {
			name: localized("name"),
			summary: localized("summary"),
			about: localized("about"),
			region: localized("region"),
			district: localized("district"),
			city: localized("city"),
			category: value("category") || null,
			online: (field("online") as HTMLInputElement).checked,
			country,
			federalDistrict: country === "RU" ? value("federalDistrict") || null : null,
			address: value("address") || null,
			latitude: plain?.coordinates?.lat ?? null,
			longitude: plain?.coordinates?.lon ?? null,
			links: lines(value("links")).map((url) => ({ url })),
			leader: value("leader") || null,
			phones: lines(value("phones")),
			emails: lines(value("emails")),
			features: featuresChanged ? (features.length || card ? { [lang]: { items: features } } : null) : null,
			facts: plain?.facts ?? [],
			sources: sources.map((url) => ({ url, title: titles.get(url) ?? null })),
		};
	}

	function clearErrors() {
		errorBox.hidden = true;
		for (const el of form.querySelectorAll<HTMLElement>("[data-error]")) {
			el.textContent = "";
			el.classList.add("hidden");
		}
		for (const el of form.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
	}

	function showErrors(fields: Record<string, string>) {
		const general: string[] = [];
		for (const [key, message] of Object.entries(fields)) {
			const box = form.querySelector<HTMLElement>(`[data-field="${fieldOf(key)}"]`);
			const slot = box?.querySelector<HTMLElement>("[data-error]");
			if (!slot) {
				general.push(message);
				continue;
			}
			slot.textContent = slot.textContent ? `${slot.textContent} ${message}` : message;
			slot.classList.remove("hidden");
			box?.querySelector("input, textarea, select")?.setAttribute("aria-invalid", "true");
		}
		errorBox.textContent = [messages["submit.errors"], ...general].filter(Boolean).join(" ");
		errorBox.hidden = false;
		(form.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
		errorBox.scrollIntoView({ block: "nearest" });
	}

	function fail(text: string) {
		errorBox.textContent = text;
		errorBox.hidden = false;
		errorBox.scrollIntoView({ block: "nearest" });
	}

	async function uploadLogo(): Promise<string | null> {
		const file = (field("logo") as HTMLInputElement | null)?.files?.[0];
		if (!file) return null;
		const body = new FormData();
		body.append("file", file);
		const uploaded = await api<{ key: string }>("/logos", { method: "POST", body });
		return uploaded.key;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		clearErrors();
		button.disabled = true;
		button.textContent = button.dataset.busy ?? "";
		try {
			const logo = await uploadLogo();
			const captchaToken = await captcha.token();
			const role = (form.querySelector('input[name="role"]:checked') as HTMLInputElement | null)?.value ?? null;
			const body = {
				center: centerFields(),
				baseVersion: card?.version ?? null,
				logo,
				removeLogo: Boolean((field("removeLogo") as HTMLInputElement | null)?.checked),
				submitter: {
					name: value("submitterName"),
					phone: value("submitterPhone") || null,
					telegram: value("submitterTelegram") || null,
					email: value("submitterEmail") || null,
					role,
				},
				comment: value("comment") || null,
				language: lang,
				captchaToken,
				website: value("website"),
			};
			const path = code ? `/centers/${encodeURIComponent(code)}/submissions` : "/submissions";
			const created = await api<{ id: number; token: string; createdAt: string }>(path, { method: "POST", body: JSON.stringify(body) });
			saveSubmission({ id: created.id, token: created.token, title: value("name") || textOf(card?.name), createdAt: created.createdAt });
			form.hidden = true;
			const done = root!.querySelector<HTMLElement>("[data-submit-done]")!;
			done.querySelector("[data-done-title]")!.textContent = t("submit.done", { id: created.id });
			done.hidden = false;
			done.scrollIntoView({ block: "start" });
		} catch (error) {
			const e = error instanceof ApiError ? error : new ApiError(0, "network", null);
			if (e.code === "invalid" && Object.keys(e.fields).length) showErrors(e.fields);
			else if (e.code === "no_changes") fail(t("submit.noChanges"));
			else if (e.status === 429) fail(t("submit.tooMany"));
			else if (e.code === "submissions_unavailable") fail(t("submit.closed"));
			else if (e.status === 0 || e.status >= 500) fail(t("submit.unavailable"));
			else fail(t("submit.failed", { reason: e.detail ?? e.code }));
		} finally {
			captcha.reset();
			button.disabled = false;
			button.textContent = button.dataset.label ?? "";
		}
	}

	async function start() {
		try {
			config = await api<CatalogConfig>("/config");
			if (code) {
				// Тексты — на языке страницы (с запасным), простые поля — из русской карточки: там федеральный округ
				// в том написании, которое ждёт сервер.
				const [localizedCard, russianCard] = await Promise.all([
					api<{ data: CenterCard }>(`/centers/${encodeURIComponent(code)}?lang=${lang}`),
					lang === "ru" ? null : api<{ data: CenterCard }>(`/centers/${encodeURIComponent(code)}?lang=ru`),
				]);
				card = localizedCard.data;
				plain = russianCard?.data ?? card;
			}
		} catch (error) {
			show(error instanceof ApiError && error.status === 404 ? t("submit.notFound") : t("submit.unavailable"));
			return;
		}
		if (!config.submissionsOpen) {
			show(t("submit.closed"));
			return;
		}
		if (card) {
			const heading = document.querySelector<HTMLElement>("[data-submit-heading]");
			const intro = document.querySelector<HTMLElement>("[data-submit-intro]");
			if (heading) heading.textContent = `${t("submit.titleEdit")}: ${textOf(card.name)}`;
			if (intro) intro.textContent = t("submit.descriptionEdit");
		}
		fillOptions();
		prefill();
		captcha = await createCaptcha(config, root!.querySelector<HTMLElement>("[data-captcha]")!, lang).catch(() => ({
			token: async () => null,
			reset: () => {},
		}));
		field("country")?.addEventListener("change", toggleRussia);
		form.addEventListener("submit", submit);
		status.hidden = true;
		form.hidden = false;
	}

	void start();
}
