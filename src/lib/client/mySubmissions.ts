/**
 * «Мои заявки» (src/components/submit/MySubmissions.astro): ключи заявок с этого устройства → статусы из API
 * каталога; заявку на проверке можно отозвать, любую — убрать из списка на этом устройстве.
 */
import { api, ApiError, forgetSubmission, savedSubmissions, type SubmissionView, textOf } from "@/lib/client/catalogApi";

/** Подписи полей карточки для «Поменяли: …» (ключи API: name.ru, links, logo). */
const FIELD_LABELS: Record<string, { ru: string; en: string }> = {
	name: { ru: "название", en: "name" },
	summary: { ru: "коротко", en: "summary" },
	about: { ru: "о центре", en: "about" },
	category: { ru: "народ", en: "people" },
	online: { ru: "онлайн", en: "online" },
	country: { ru: "страна", en: "country" },
	region: { ru: "регион", en: "region" },
	district: { ru: "район", en: "district" },
	city: { ru: "город", en: "city" },
	federalDistrict: { ru: "федеральный округ", en: "federal district" },
	address: { ru: "адрес", en: "address" },
	coordinates: { ru: "точка на карте", en: "map point" },
	links: { ru: "ссылки", en: "links" },
	leader: { ru: "руководитель", en: "director" },
	phones: { ru: "телефоны", en: "phones" },
	emails: { ru: "email", en: "emails" },
	features: { ru: "особенности", en: "highlights" },
	facts: { ru: "прочее", en: "other" },
	sources: { ru: "источники", en: "sources" },
	logo: { ru: "логотип", en: "logo" },
};

function fieldLabel(key: string, lang: string): string {
	const [field, language] = key.split(".", 2);
	const label = FIELD_LABELS[field ?? ""]?.[lang === "ru" ? "ru" : "en"] ?? key;
	return language ? `${label} (${language})` : label;
}

export function initMySubmissions() {
	const root = document.querySelector<HTMLElement>("[data-my-root]");
	if (!root) return;
	const list = root.querySelector<HTMLUListElement>("[data-my-list]")!;
	const empty = root.querySelector<HTMLElement>("[data-my-empty]")!;
	const status = root.querySelector<HTMLElement>("[data-my-status]")!;
	const messages = JSON.parse(root.dataset.messages ?? "{}") as Record<string, string>;
	const lang = root.dataset.locale ?? "ru";
	const centersBase = root.dataset.centersBase ?? "/centers";
	const t = (key: string, vars: Record<string, string | number> = {}) =>
		(messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
	const date = new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" });

	const badge: Record<SubmissionView["status"], string> = {
		pending: "bg-muted text-foreground",
		approved: "bg-accent text-accent-foreground",
		rejected: "bg-destructive/15 text-destructive",
		withdrawn: "bg-muted text-subtle-foreground",
	};

	function render(items: SubmissionView[], tokens: Map<number, string>, titles: Map<number, string>) {
		list.replaceChildren();
		empty.hidden = items.length > 0;
		for (const s of items) {
			const li = document.createElement("li");
			li.className = "flex flex-col gap-2 rounded-catalog corner-squircle border border-border-muted bg-surface p-4 text-sm";

			const head = document.createElement("div");
			head.className = "flex flex-wrap items-center gap-2";
			const title = document.createElement("strong");
			title.className = "text-base text-foreground";
			title.textContent = textOf(s.name) || titles.get(s.id) || `№ ${s.id}`;
			const state = document.createElement("span");
			state.className = `rounded-full px-2.5 py-0.5 text-xs font-medium ${badge[s.status] ?? badge.pending}`;
			state.textContent = t(`my.status.${s.status}`);
			head.append(title, state);

			const meta = document.createElement("p");
			meta.className = "text-muted-foreground";
			meta.textContent = `${t(`my.kind.${s.kind}`)} · № ${s.id} · ${t("my.sent", { date: date.format(new Date(s.createdAt)) })}`;
			li.append(head, meta);

			if (s.kind === "edit" && s.changedFields.length) {
				const changed = document.createElement("p");
				changed.className = "text-subtle-foreground";
				changed.textContent = t("my.changed", { fields: s.changedFields.map((key) => fieldLabel(key, lang)).join(", ") });
				li.append(changed);
			}
			if (s.status === "rejected" && s.reason) {
				const reason = document.createElement("p");
				reason.className = "text-foreground";
				reason.textContent = `${t("my.reason")}: ${s.reason}`;
				li.append(reason);
			}

			const actions = document.createElement("div");
			actions.className = "flex flex-wrap gap-4";
			if (s.center) {
				const open = Object.assign(document.createElement("a"), { href: `${centersBase}/${s.center}/`, textContent: t("my.open") });
				open.className = "font-medium text-foreground underline";
				actions.append(open);
			}
			if (s.status === "pending") {
				const withdraw = Object.assign(document.createElement("button"), { type: "button", textContent: t("my.withdraw") });
				withdraw.className = "cursor-pointer font-medium text-destructive underline";
				withdraw.addEventListener("click", async () => {
					if (!confirm(t("my.withdrawConfirm", { id: s.id }))) return;
					withdraw.disabled = true;
					try {
						await api(`/submissions/${s.id}`, { method: "DELETE", headers: { "X-Submission-Token": tokens.get(s.id) ?? "" } });
					} catch {
						// Уже отозвана или рассмотрена — список обновится и так.
					}
					await load();
				});
				actions.append(withdraw);
			}
			const forget = Object.assign(document.createElement("button"), { type: "button", textContent: t("my.forget") });
			forget.className = "cursor-pointer text-subtle-foreground underline";
			forget.addEventListener("click", () => {
				forgetSubmission(s.id);
				void load();
			});
			actions.append(forget);
			li.append(actions);
			list.append(li);
		}
	}

	async function load() {
		const saved = savedSubmissions();
		const tokens = new Map(saved.map((s) => [s.id, s.token]));
		const titles = new Map(saved.map((s) => [s.id, s.title]));
		status.hidden = true;
		if (saved.length === 0) {
			render([], tokens, titles);
			return;
		}
		try {
			const found = await api<{ data: SubmissionView[] }>("/submissions/lookup", {
				method: "POST",
				body: JSON.stringify({ tokens: saved.map((s) => s.token) }),
			});
			render(found.data, tokens, titles);
		} catch (error) {
			status.textContent = error instanceof ApiError && error.status === 429 ? error.detail ?? "" : t("submit.unavailable");
			status.hidden = false;
		}
	}

	void load();
}
