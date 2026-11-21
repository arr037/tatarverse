const siteUrl = "https://tatarverse.cc/" as const;
const siteHost = new URL(siteUrl).hostname.replace(/^www\./, "");
const siteLocale = "ru-RU" as const;
const siteAuthor = "proxima812" as const;
const siteName = "tatarverse" as const;
const siteThemeColors = {
  maskIcon: "#111012",
  tile: "#111012",
  theme: "#111012",
  background: "#FFFFFF",
} as const;

export const config = {
  features: {
    manifest: true,
    ai: true,
    llms: true,
    indexNow: false,
  },
  indexNow: {
    key: "",
  },
  /** Куда присылать исправления и дополнения к карточкам и переводам. */
  feedbackUrl: "https://t.me/the_tatarverse/8",
  /**
   * API каталога: центры (сборка берёт их отсюда, scripts/centers-from-api.ts), заявки «Добавить центр» и
   * «Предложить правку», «Мои заявки». Описание — https://api.tatarverse.cc/docs/. Для разработки — своя копия:
   * PUBLIC_TATARVERSE_API=http://localhost:5080/api/tatarverse.
   */
  api: {
    url: ((import.meta.env?.PUBLIC_TATARVERSE_API as string | undefined) || "https://api.tatarverse.cc").replace(/\/+$/, ""),
  },
  site: {
    url: siteUrl,
    language: "ru-RU",
    OG: {
      title: siteName,
      description:
        "ТБК - это татары, башкиры и крымские татары. tatarverse помогает найти культурные центры, сообщества, источники и справочную информацию по странам, городам, регионам и категориям.",
      author: siteAuthor,
      locale: siteLocale,
      site_name: siteName,
      defaultImage: "default-ogImage.png",
      imageAlt: `Превью страницы ${siteHost}`,
      keywords: [
        "ТБК",
        "татары",
        "башкиры",
        "крымские татары",
        "татарские центры",
        "башкирские центры",
        "крымскотатарские центры",
        "татарская диаспора",
        "культурные центры",
        "национально-культурные автономии",
      ],
      titleSeparator: "•",
      twitterCard: "summary_large_image",
      twitterSite: "",
      twitterCreator: "",
      organizationName: siteName,
      logo: "",
    },
    theme: {
      colors: siteThemeColors,
    },
    verifications: [
      { name_verification: "yandex-verification", content: "ef2c55e1bcb7f431" },
      {
        name_verification: "google-site-verification",
        content: "ax8dybdaENiWae9wwuPwxMC0GOluT8W9v0yDpIM1AKo",
      },
    ],
    analytics: {
      yandexMetrika: {
        enabled: false,
        counterId: "",
      },
      googleTagManager: {
        enabled: false,
        gtmId: "",
      },
    },
  },
} satisfies AppConfig;

export type SeoPageType = "website" | "article";
export type SeoKeywords = string | string[];

export interface SiteVerification {
  name_verification: string;
  content: string;
}

export interface YandexMetrikaConfig {
  enabled: boolean;
  counterId: number | `${number}` | "";
}

export interface GoogleTagManagerConfig {
  enabled: boolean;
  gtmId: number | `${number}` | "";
}

export interface SiteOpenGraphConfig {
  title: string;
  description: string;
  author: string;
  locale: `${string}-${string}`;
  site_name: string;
  defaultImage: string;
  imageAlt: string;
  keywords: SeoKeywords;
  titleSeparator: string;
  twitterCard: "summary" | "summary_large_image";
  twitterSite: string;
  twitterCreator: string;
  organizationName: string;
  logo: string;
}

export interface SiteThemeColors {
  maskIcon: `#${string}`;
  tile: `#${string}`;
  theme: `#${string}`;
  background: `#${string}`;
}

export interface SiteConfig {
  url: `http${"" | "s"}://${string}`;
  language: string;
  OG: SiteOpenGraphConfig;
  theme: {
    colors: SiteThemeColors;
  };
  verifications: SiteVerification[];
  analytics: {
    yandexMetrika: YandexMetrikaConfig;
    googleTagManager: GoogleTagManagerConfig;
  };
}

export interface AppConfig {
  features: {
    manifest: boolean;
    ai: boolean;
    llms: boolean;
    indexNow: boolean;
  };
  indexNow: {
    key: string;
  };
  feedbackUrl: string;
  /** API каталога (api.tatarverse.cc): адрес без «/» в конце. */
  api: {
    url: string;
  };
  site: SiteConfig;
}
