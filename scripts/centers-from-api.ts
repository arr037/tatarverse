/**
 * Центры из API каталога → карточки сайта.
 *
 * Источник правды — база каталога на api.tatarverse.cc (заявки людей, модерация, история), а сайт по-прежнему
 * собирается из .mdx: скрипт перед сборкой выгружает все опубликованные центры на русском и английском и
 * переписывает src/data/centers_formatted/*.mdx и src/data/centers_i18n/en/*.mdx в том же виде, в каком их
 * писали руками. Страницы, поиск, фильтры, RSS, статический API v1 и OG-картинки работают как раньше.
 *
 * Запуск: `bun run centers:sync` (его же зовёт `bun run build`). Адрес API — TATARVERSE_API
 * (по умолчанию https://api.tatarverse.cc). API недоступен или пуст — файлы прошлой выгрузки остаются как
 * есть, сборка идёт дальше с предупреждением; TATARVERSE_API_STRICT=1 — вместо этого падать.
 * Центр скрыли или удалили в модерации — его файл удаляется.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeRuRegion, suggestRuRegion } from "../src/data/geo/ruRegions";

const API = (process.env.TATARVERSE_API ?? "https://api.tatarverse.cc").replace(/\/+$/, "");
const STRICT = process.env.TATARVERSE_API_STRICT === "1";
const DIRS = { ru: "src/data/centers_formatted", en: "src/data/centers_i18n/en" } as const;

type Lang = keyof typeof DIRS;
type Texts = Record<string, { text?: string | null } | null> | null;
type Lists = Record<string, { items?: string[] | null } | null> | null;

interface Location {
	flag?: string | null;
	country?: string | null;
	countryCode?: string | null;
	region?: Texts;
	district?: Texts;
	city?: Texts;
}

interface Card {
	id: string;
	name: Texts;
	summary: Texts;
	about: Texts;
	typeCode: "russia" | "abroad" | "online";
	categoryCode: "tatar" | "tatar-bashkir" | "bashkir" | "crimean-tatar";
	online: boolean;
	source?: string | null;
	pubDate?: string | null;
	location?: Location | null;
	address?: string | null;
	links: Array<{ url: string; kind?: string | null }>;
	leader?: string | null;
	phones: string[];
	emails: string[];
	features: Lists;
	facts: Array<{ label: string; value: string }>;
	sources: Array<{ url: string; title?: string | null }>;
}

/** Вид и народ — русскими словами: так их ждёт схема коллекции (src/content.config.ts) на обоих языках. */
const TYPES = { russia: "Регион РФ", abroad: "Зарубежный", online: "Онлайн" } as const;
const CATEGORIES = {
	tatar: "Татарский",
	"tatar-bashkir": "Татаро-Башкирский",
	bashkir: "Башкирский",
	"crimean-tatar": "Крымотатарский",
} as const;

const HEADINGS = {
	ru: { contacts: "Контакты", links: "Ссылки", features: "Особенности", about: "О центре", other: "Прочее", sources: "Источники" },
	en: { contacts: "Contacts", links: "Links", features: "Highlights", about: "About", other: "Other", sources: "Sources" },
} as const;

const CONTACT_LABELS = {
	ru: { leader: "Руководитель", phone: "Телефон", email: "Email", address: "Адрес" },
	en: { leader: "Director", phone: "Phone", email: "Email", address: "Address" },
} as const;

const LINK_LABELS: Record<string, string> = {
	instagram: "Instagram",
	telegram: "Telegram",
	whatsapp: "WhatsApp",
	vk: "VK",
	youtube: "YouTube",
	facebook: "Facebook",
	tiktok: "TikTok",
	ok: "OK",
	x: "X",
	max: "MAX",
};

const warnings: string[] = [];

/** Лимит API на чтение — 300 запросов в минуту с адреса: на 429 ждём, пока окно сменится. */
async function getJson<T>(url: string, attempt = 0): Promise<T> {
	const response = await fetch(url, { headers: { Accept: "application/json" } });
	if (response.status === 429 && attempt < 10) {
		await new Promise((resolve) => setTimeout(resolve, attempt < 2 ? 3000 : 15000));
		return getJson<T>(url, attempt + 1);
	}
	if (!response.ok) throw new Error(`${url} → ${response.status}`);
	return (await response.json()) as T;
}

/**
 * Все карточки на языке: одним запросом (/centers/export), а у API без него — списком по страницам (по 50: page,
 * pages) и карточками по одной.
 */
async function fetchCards(lang: Lang): Promise<Card[]> {
	const bulk = await fetch(`${API}/centers/export?lang=${lang}`, { headers: { Accept: "application/json" } });
	if (bulk.ok) return ((await bulk.json()) as { data: Card[] }).data;
	if (bulk.status !== 404) throw new Error(`${API}/centers/export → ${bulk.status}`);

	const ids: Array<{ id: string }> = [];
	for (let page = 1; ; page++) {
		const list = await getJson<{ data: Array<{ id: string }>; pages?: number }>(`${API}/centers?lang=${lang}&page=${page}`);
		ids.push(...list.data);
		// Без pages — прежний API: весь список одной страницей.
		if (!list.pages || page >= list.pages || list.data.length === 0) break;
	}
	const cards: Card[] = [];
	const queue = [...ids];
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			for (let item = queue.shift(); item; item = queue.shift()) {
				cards.push((await getJson<{ data: Card }>(`${API}/centers/${item.id}?lang=${lang}`)).data);
			}
		}),
	);
	return cards;
}

/** Текст поля: API отдаёт объект с одним языком — выбранным или запасным. */
const text = (value: Texts | undefined): string | null => {
	for (const item of Object.values(value ?? {})) {
		const t = item?.text?.trim();
		if (t) return t;
	}
	return null;
};

const items = (value: Lists | undefined): string[] => {
	for (const item of Object.values(value ?? {})) {
		const list = (item?.items ?? []).map((x) => x.trim()).filter(Boolean);
		if (list.length) return list;
	}
	return [];
};

/** Строка Markdown/MDX как текст: служебные знаки — экранированы, начало строки не станет списком или заголовком. */
function plain(value: string): string {
	return value
		.replace(/[\\`*_[\]{}<>|~&]/g, (ch) => `\\${ch}`)
		.replace(/^(\s*)([#+\-=])/gm, (_, space: string, mark: string) => `${space}\\${mark}`)
		.replace(/^(\s*)(\d+)([.)])/gm, (_, space: string, digits: string, mark: string) => `${space}${digits}\\${mark}`);
}

const url = (value: string) => value.trim().replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

const hostname = (value: string) => {
	try {
		return new URL(value).hostname.replace(/^www\./, "");
	} catch {
		return value;
	}
};

function frontmatter(card: Card, lang: Lang): string {
	const location = card.location;
	const region = lang === "ru" ? regionFor(card, text(location?.region)) : text(location?.region);
	const place = {
		country: location?.country ?? undefined,
		region: region ?? undefined,
		district: text(location?.district) ?? undefined,
		city: text(location?.city) ?? undefined,
	};
	const lines = [
		"---",
		`title: ${JSON.stringify(text(card.name) ?? card.id)}`,
		card.pubDate ? `pubDate: ${JSON.stringify(card.pubDate)}` : null,
		`type: ${JSON.stringify(TYPES[card.typeCode] ?? TYPES.abroad)}`,
		`category: ${JSON.stringify(CATEGORIES[card.categoryCode] ?? CATEGORIES.tatar)}`,
		card.source ? `source: ${JSON.stringify(card.source)}` : null,
		text(card.summary) ? `summary: ${JSON.stringify(text(card.summary))}` : null,
	];
	const placeLines = Object.entries(place)
		.filter(([, v]) => Boolean(v))
		.map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`);
	if (placeLines.length) lines.push("location:", ...placeLines);
	lines.push("---");
	return lines.filter((line): line is string => line !== null).join("\n");
}

/**
 * Регион России — в написании справочника сайта (src/data/geo/ruRegions.ts): по нему работают фильтры и федеральные
 * округа. Незнакомое написание (новый центр из заявки) — ближайшее похожее, иначе как есть с предупреждением.
 */
function regionFor(card: Card, region: string | null): string | null {
	if (!region || card.location?.countryCode !== "RU") return region;
	const canonical = normalizeRuRegion(region) ?? suggestRuRegion(region);
	if (!canonical) warnings.push(`${card.id}: регион «${region}» не найден в справочнике субъектов РФ`);
	return canonical ?? region;
}

function body(card: Card, lang: Lang): string {
	const h = HEADINGS[lang];
	const c = CONTACT_LABELS[lang];
	const sections: string[] = [];
	const section = (title: string, content: string[]) => {
		if (content.length) sections.push(`## ${title}\n\n${content.join("\n")}`);
	};

	section(h.contacts, [
		...(card.leader ? [`- ${c.leader}: ${plain(card.leader)}`] : []),
		...card.phones.map((phone) => `- ${c.phone}: [${plain(phone)}](tel:${url(phone)})`),
		...card.emails.map((email) => `- ${c.email}: [${plain(email)}](mailto:${url(email)})`),
		...(card.address ? [`- ${c.address}: ${plain(card.address)}`] : []),
	]);
	section(h.links, card.links.map((link) => `- [${plain(LINK_LABELS[link.kind ?? ""] ?? hostname(link.url))}](${url(link.url)})`));
	section(h.features, items(card.features).map((item) => `- ${plain(item)}`));
	const about = text(card.about);
	if (about) sections.push(`## ${h.about}\n\n${about.split(/\n{2,}/).map((p) => plain(p.trim())).join("\n\n")}`);
	section(h.other, card.facts.map((fact) => `> - ${plain(fact.label)}: ${plain(fact.value)}`));
	// Основной источник — в шапке (source), в списке источников он не повторяется.
	const sources = card.sources.filter((source) => source.url !== card.source);
	section(h.sources, sources.map((source) => `- [${plain(source.title?.trim() || hostname(source.url))}](${url(source.url)})`));
	return sections.join("\n\n");
}

async function writeLanguage(lang: Lang, cards: Card[]): Promise<number> {
	const dir = path.resolve(DIRS[lang]);
	await mkdir(dir, { recursive: true });
	const keep = new Set<string>();
	for (const card of cards) {
		const file = `${card.id}.mdx`;
		keep.add(file);
		await writeFile(path.join(dir, file), `${frontmatter(card, lang)}\n\n${body(card, lang)}\n`, "utf8");
	}
	let removed = 0;
	for (const file of await readdir(dir)) {
		if (/^tbk-\d+\.mdx?$/.test(file) && !keep.has(file)) {
			await rm(path.join(dir, file));
			removed++;
		}
	}
	return removed;
}

async function main() {
	let ru: Card[];
	let en: Card[];
	try {
		[ru, en] = await Promise.all([fetchCards("ru"), fetchCards("en")]);
	} catch (error) {
		const message = `API каталога недоступно (${API}): ${(error as Error).message}`;
		if (STRICT) throw new Error(message);
		console.warn(`[centers] ${message} — остаются карточки прошлой выгрузки`);
		return;
	}
	if (ru.length === 0) {
		const message = `API каталога (${API}) вернуло 0 центров — центры ещё не перенесены?`;
		if (STRICT) throw new Error(message);
		console.warn(`[centers] ${message} Остаются карточки прошлой выгрузки`);
		return;
	}

	const removedRu = await writeLanguage("ru", ru);
	const removedEn = await writeLanguage("en", en);
	for (const warning of warnings) console.warn(`[centers] ${warning}`);
	console.log(`[centers] ${API}: ${ru.length} центров (en: ${en.length}), убрано скрытых: ${removedRu + removedEn}`);
}

await main();
