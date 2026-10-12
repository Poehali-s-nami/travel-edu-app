import type { LearningTrack, Material } from "@/types/material";

export const durationOptions = ["До 15 минут", "15-45 минут", "45-90 минут", "Более 90 минут"];
export const videoFormats = ["Вебинар", "Видеоурок", "Практический разбор", "Инструкция"] as const;

export function videoFormat(format: string) {
  return format.trim() || "Вебинар";
}

export function normalizeCategory(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function categoryKey(value: string) {
  return normalizeCategory(value).toLocaleLowerCase("ru");
}

const webinarCovers = [
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1526772662000-3f88f10405ff?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80"
];

const knowledgeCovers = [
  "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1556745757-8d76bdb6984b?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1506784365847-bbad939e9335?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80"
];

export const demoMaterials: Material[] = [
  {
    id: "demo-webinar-content-sales",
    title: "Как продавать туры через экспертный контент",
    description:
      "Практический вебинар о прогреве аудитории, доверии и упаковке туристического предложения.",
    type: "video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    coverUrl: webinarCovers[0],
    category: ["Маркетинг", "Продажи"],
    tags: ["контент", "воронка", "прогрев"],
    format: "Вебинар",
    author: { name: "Анна Литвинова", company: "Поехали с нами" },
    duration: 42,
    createdAt: new Date("2026-06-12"),
    trendingStamp: "Горячий выпуск",
    views: 284,
    tab: "webinars"
  },
  {
    id: "demo-webinar-unit-economics",
    title: "Юнит-экономика авторского тура",
    description:
      "Разбор маржинальности, комиссий, сезонности и точки безубыточности.",
    type: "video",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    coverUrl: webinarCovers[1],
    category: ["Финансы", "Продукт"],
    tags: ["юнит-экономика", "маржа"],
    format: "Вебинар",
    author: { name: "Денис Кравцов", company: "Travel Finance" },
    duration: 56,
    createdAt: new Date("2026-04-18"),
    trendingStamp: "Must read",
    views: 193,
    tab: "webinars"
  },
  {
    id: "demo-webinar-service-standards",
    title: "Сервисные стандарты для турагентов",
    description:
      "Как выстроить единый уровень коммуникации до, во время и после поездки.",
    type: "video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    coverUrl: webinarCovers[2],
    category: ["Сервис", "Операции"],
    tags: ["клиенты", "стандарты"],
    format: "Вебинар",
    author: { name: "Мария Орлова", company: "Service Team" },
    duration: 38,
    createdAt: new Date("2026-05-04"),
    trendingStamp: "Полезно знать",
    views: 241,
    tab: "webinars"
  },
  {
    id: "demo-webinar-product-packaging",
    title: "Упаковка туристического продукта",
    description:
      "Как описывать маршрут, ценность и условия так, чтобы клиент быстрее принимал решение.",
    type: "video",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    coverUrl: webinarCovers[3],
    category: ["Продукт", "Маркетинг"],
    tags: ["упаковка", "маршрут"],
    format: "Вебинар",
    author: { name: "Игорь Соколов", company: "Travel Product Lab" },
    duration: 47,
    createdAt: new Date("2026-03-22"),
    trendingStamp: "Must read",
    views: 156,
    tab: "webinars"
  },
  {
    id: "demo-webinar-repeat-sales",
    title: "Повторные продажи в туризме",
    description:
      "Сценарии касаний, персональные предложения и работа с базой после поездки.",
    type: "video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    coverUrl: webinarCovers[4],
    category: ["Продажи", "CRM"],
    tags: ["повторные продажи", "база"],
    format: "Вебинар",
    author: { name: "Ольга Ветрова", company: "Sales Team" },
    duration: 33,
    createdAt: new Date("2026-02-15"),
    trendingStamp: "Полезно знать",
    views: 128,
    tab: "webinars"
  },
  {
    id: "demo-webinar-objections",
    title: "Работа с возражениями туристов",
    description:
      "Практика ответов на вопросы про цену, безопасность, документы и сроки.",
    type: "video",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    coverUrl: webinarCovers[5],
    category: ["Продажи", "Сервис"],
    tags: ["возражения", "диалоги"],
    format: "Вебинар",
    author: { name: "Павел Романов", company: "Поехали с нами" },
    duration: 29,
    createdAt: new Date("2026-01-28"),
    views: 97,
    tab: "webinars"
  },
  {
    id: "demo-knowledge-group-tour-checklist",
    title: "Чек-лист запуска группового тура",
    description:
      "Документ для проверки маршрута, партнеров, стоимости и коммуникации с туристами.",
    type: "file",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    coverUrl: knowledgeCovers[0],
    category: ["Продукт", "Операции"],
    tags: ["чек-лист", "группы"],
    format: "PDF",
    author: { name: "", company: "" },
    duration: 15,
    createdAt: new Date("2026-06-20"),
    tab: "knowledge"
  },
  {
    id: "demo-knowledge-client-scripts",
    title: "Скрипты переписки с клиентами",
    description:
      "Готовые формулировки для первичного контакта, возражений и повторных продаж.",
    type: "file",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    coverUrl: knowledgeCovers[1],
    category: ["Продажи", "Сервис"],
    tags: ["скрипты", "клиенты"],
    format: "Документ",
    author: { name: "", company: "" },
    duration: 8,
    createdAt: new Date("2026-05-28"),
    tab: "knowledge"
  },
  {
    id: "demo-knowledge-brief-template",
    title: "Шаблон брифа на авторский тур",
    description:
      "Форма для сбора вводных по аудитории, маршруту, цене и ожидаемому результату.",
    type: "file",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    coverUrl: knowledgeCovers[2],
    category: ["Продукт", "Документы"],
    tags: ["бриф", "шаблон"],
    format: "Документ",
    author: { name: "", company: "" },
    duration: 10,
    createdAt: new Date("2026-05-12"),
    tab: "knowledge"
  },
  {
    id: "demo-knowledge-finance-table",
    title: "Таблица расчета себестоимости тура",
    description:
      "Шаблон для учета проживания, транспорта, комиссий, сопровождения и маржи.",
    type: "file",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    coverUrl: knowledgeCovers[3],
    category: ["Финансы", "Продукт"],
    tags: ["таблица", "расчет"],
    format: "Таблица",
    author: { name: "", company: "" },
    duration: 12,
    createdAt: new Date("2026-04-30"),
    tab: "knowledge"
  },
  {
    id: "demo-knowledge-content-plan",
    title: "Контент-план для продвижения тура",
    description:
      "Структура публикаций на 4 недели: прогрев, экспертность, социальное доказательство и оффер.",
    type: "file",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    coverUrl: knowledgeCovers[4],
    category: ["Маркетинг", "Контент"],
    tags: ["контент-план", "продвижение"],
    format: "PDF",
    author: { name: "", company: "" },
    duration: 9,
    createdAt: new Date("2026-03-16"),
    tab: "knowledge"
  },
  {
    id: "demo-knowledge-service-map",
    title: "Карта клиентского пути",
    description:
      "Схема касаний клиента от первого запроса до повторной покупки после тура.",
    type: "file",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    coverUrl: knowledgeCovers[5],
    category: ["Сервис", "CRM"],
    tags: ["customer journey", "сервис"],
    format: "Презентация",
    author: { name: "", company: "" },
    duration: 11,
    createdAt: new Date("2026-02-26"),
    tab: "knowledge"
  }
];

export const demoTracks: LearningTrack[] = [
  {
    id: "demo-track-start-sales",
    title: "Старт продаж авторского тура",
    description:
      "Последовательность материалов для упаковки, расчета и запуска продаж тура.",
    materialIds: [
      "demo-webinar-content-sales",
      "demo-webinar-unit-economics",
      "demo-knowledge-client-scripts"
    ],
    tags: ["продажи", "маркетинг", "старт"],
    coverUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
    createdAt: new Date("2026-07-01")
  },
  {
    id: "demo-track-service",
    title: "Сервис и сопровождение клиента",
    description:
      "Материалы для настройки коммуникаций, стандартов и клиентского пути.",
    materialIds: [
      "demo-webinar-service-standards",
      "demo-knowledge-service-map",
      "demo-knowledge-client-scripts"
    ],
    tags: ["сервис", "клиенты"],
    coverUrl:
      "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80",
    createdAt: new Date("2026-06-22")
  },
  {
    id: "demo-track-finance",
    title: "Финансы авторского тура",
    description:
      "От себестоимости до маржинальности: базовая финансовая логика продукта.",
    materialIds: [
      "demo-knowledge-finance-table",
      "demo-webinar-unit-economics",
      "demo-knowledge-group-tour-checklist"
    ],
    tags: ["финансы", "расчет"],
    coverUrl:
      "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1200&q=80",
    createdAt: new Date("2026-06-10")
  },
  {
    id: "demo-track-marketing",
    title: "Маркетинг и контент тура",
    description:
      "Как сформировать контент, доверие и понятную ценность поездки.",
    materialIds: [
      "demo-knowledge-content-plan",
      "demo-webinar-content-sales",
      "demo-webinar-product-packaging"
    ],
    tags: ["маркетинг", "контент"],
    coverUrl:
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80",
    createdAt: new Date("2026-05-18")
  },
  {
    id: "demo-track-product",
    title: "Упаковка туристического продукта",
    description:
      "От брифа и маршрута до понятного оффера и чек-листа запуска.",
    materialIds: [
      "demo-knowledge-brief-template",
      "demo-webinar-product-packaging",
      "demo-knowledge-group-tour-checklist"
    ],
    tags: ["продукт", "упаковка"],
    coverUrl:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
    createdAt: new Date("2026-04-08")
  },
  {
    id: "demo-track-repeat-sales",
    title: "Повторные продажи и CRM",
    description:
      "Работа с базой, сценарии повторных касаний и мягкие допродажи.",
    materialIds: [
      "demo-webinar-repeat-sales",
      "demo-knowledge-service-map",
      "demo-webinar-objections"
    ],
    tags: ["crm", "повторные продажи"],
    coverUrl:
      "https://images.unsplash.com/photo-1556761175-4b46a572b786?auto=format&fit=crop&w=1200&q=80",
    createdAt: new Date("2026-03-03")
  }
];

export function getSpeakerCompanyLabel(material: Material) {
  return [material.author.name, material.author.company]
    .filter(Boolean)
    .join(" / ");
}

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "ru")
  );
}

export function getDurationBucket(duration: number) {
  if (duration <= 15) {
    return "До 15 минут";
  }

  if (duration <= 45) {
    return "15-45 минут";
  }

  if (duration <= 90) {
    return "45-90 минут";
  }

  return "Более 90 минут";
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}
