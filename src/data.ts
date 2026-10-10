/**
 * All research data for the app. Everything here is fictional and deterministic —
 * there are no network calls anywhere in this repo.
 *
 * Figures are in USD millions unless stated otherwise. Fiscal years end Dec 31.
 */

export interface Company {
  name: string;
  ticker: string;
  sector: string;
  hq: string;
  founded: number;
  employees: number;
  description: string;
  segments: { name: string; shareOfRevenue: number }[];
  filings: { id: string; form: string; period: string; filedOn: string }[];
}

export interface AnnualFigures {
  fiscalYear: number;
  revenue: number | null;
  grossMargin: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
}

export interface QuarterlyFigures {
  period: string;
  revenue: number;
  grossMargin: number;
  operatingIncome: number;
}

export interface FinancialRecord {
  company: string;
  ticker: string;
  currency: string;
  unit: string;
  annual: AnnualFigures[];
  quarterly: QuarterlyFigures[];
  provenance: {
    source: string;
    ingestedAt: string;
    pipelineVersion: string;
    checksum: string;
    restatements: { period: string; note: string }[];
  };
  warnings?: string[];
}

export interface ResearchDocument {
  id: string;
  company: string;
  form: string;
  title: string;
  date: string;
  body: string;
}

export const companies: Company[] = [
  {
    name: "Acme Corp",
    ticker: "ACME",
    sector: "Industrial Automation",
    hq: "Cleveland, OH",
    founded: 1948,
    employees: 6420,
    description:
      "Designs and manufactures programmable logic controllers, motion control hardware and factory-floor sensors for discrete manufacturing customers.",
    segments: [
      { name: "Control Systems", shareOfRevenue: 0.58 },
      { name: "Sensors & Instrumentation", shareOfRevenue: 0.27 },
      { name: "Service & Support", shareOfRevenue: 0.15 },
    ],
    filings: [
      { id: "ACME-10K-2025", form: "10-K", period: "FY2025", filedOn: "2026-02-18" },
      { id: "ACME-10K-2024", form: "10-K", period: "FY2024", filedOn: "2025-02-20" },
      { id: "ACME-10Q-2025Q3", form: "10-Q", period: "FY2025 Q3", filedOn: "2025-10-29" },
    ],
  },
  {
    name: "Acme Robotics",
    ticker: "ACMR",
    sector: "Robotics",
    hq: "Austin, TX",
    founded: 2014,
    employees: 1180,
    description:
      "Builds collaborative robotic arms and the software stack that programs them, sold primarily to contract manufacturers and logistics operators. No corporate relationship to Acme Corp.",
    segments: [
      { name: "Robotic Arms", shareOfRevenue: 0.71 },
      { name: "Software & Licensing", shareOfRevenue: 0.29 },
    ],
    filings: [
      { id: "ACMR-10K-2025", form: "10-K", period: "FY2025", filedOn: "2026-03-04" },
      { id: "ACMR-10K-2024", form: "10-K", period: "FY2024", filedOn: "2025-03-06" },
    ],
  },
  {
    name: "Globex Inc",
    ticker: "GLBX",
    sector: "Diversified Industrials",
    hq: "Springfield, IL",
    founded: 1911,
    employees: 41300,
    description:
      "A diversified industrial conglomerate spanning energy equipment, building products and specialty chemicals, with roughly half of revenue outside North America.",
    segments: [
      { name: "Energy Equipment", shareOfRevenue: 0.34 },
      { name: "Building Products", shareOfRevenue: 0.39 },
      { name: "Specialty Chemicals", shareOfRevenue: 0.27 },
    ],
    filings: [
      { id: "GLBX-10K-2025", form: "10-K", period: "FY2025", filedOn: "2026-02-11" },
      { id: "GLBX-10K-2024", form: "10-K", period: "FY2024", filedOn: "2025-02-13" },
    ],
  },
  {
    name: "Initech",
    ticker: "ITCH",
    sector: "Enterprise Software",
    hq: "Dallas, TX",
    founded: 1996,
    employees: 3050,
    description:
      "Sells workflow automation and document management software to mid-market financial institutions, transitioning from perpetual licenses to subscription.",
    segments: [
      { name: "Subscription", shareOfRevenue: 0.62 },
      { name: "Perpetual License", shareOfRevenue: 0.19 },
      { name: "Professional Services", shareOfRevenue: 0.19 },
    ],
    filings: [
      { id: "ITCH-10K-2024", form: "10-K", period: "FY2024", filedOn: "2025-03-27" },
      { id: "ITCH-8K-2026-01", form: "8-K", period: "FY2025", filedOn: "2026-01-30" },
    ],
  },
  {
    name: "Umbrella Health",
    ticker: "UMBR",
    sector: "Healthcare Services",
    hq: "Raleigh, NC",
    founded: 1989,
    employees: 22750,
    description:
      "Operates outpatient specialty clinics and a pharmacy benefits administration business, growing largely through acquisition of regional clinic groups.",
    segments: [
      { name: "Clinic Operations", shareOfRevenue: 0.64 },
      { name: "Pharmacy Benefits", shareOfRevenue: 0.36 },
    ],
    filings: [
      { id: "UMBR-10K-2025", form: "10-K", period: "FY2025", filedOn: "2026-02-26" },
      { id: "UMBR-10K-2024", form: "10-K", period: "FY2024", filedOn: "2025-02-28" },
    ],
  },
];

/** Annual revenue by fiscal year. `null` means the period has not been filed. */
const REVENUE: Record<string, Record<number, number | null>> = {
  "Acme Corp": { 2021: 1840, 2022: 1975, 2023: 2088, 2024: 2143, 2025: 2260 },
  "Acme Robotics": { 2021: 210, 2022: 305, 2023: 452, 2024: 690, 2025: 1015 },
  "Globex Inc": { 2021: 8420, 2022: 8610, 2023: 8395, 2024: 8720, 2025: 8905 },
  Initech: { 2021: 640, 2022: 742, 2023: 861, 2024: 988, 2025: null },
  "Umbrella Health": { 2021: 3120, 2022: 3480, 2023: 3705, 2024: 4010, 2025: 4395 },
};

const GROSS_MARGIN: Record<string, number> = {
  "Acme Corp": 0.381,
  "Acme Robotics": 0.514,
  "Globex Inc": 0.292,
  Initech: 0.736,
  "Umbrella Health": 0.243,
};

const OPERATING_MARGIN: Record<string, number> = {
  "Acme Corp": 0.112,
  "Acme Robotics": 0.041,
  "Globex Inc": 0.089,
  Initech: 0.168,
  "Umbrella Health": 0.074,
};

/** Fixed seasonality weights so quarterly figures are reproducible. */
const SEASONALITY = [0.223, 0.241, 0.248, 0.288];

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function buildRecord(company: Company): FinancialRecord {
  const revenueByYear = REVENUE[company.name];
  const gm = GROSS_MARGIN[company.name];
  const om = OPERATING_MARGIN[company.name];

  const annual: AnnualFigures[] = [];
  const quarterly: QuarterlyFigures[] = [];

  for (const year of Object.keys(revenueByYear).map(Number).sort()) {
    const revenue = revenueByYear[year];
    if (revenue === null) {
      annual.push({
        fiscalYear: year,
        revenue: null,
        grossMargin: null,
        operatingIncome: null,
        netIncome: null,
        freeCashFlow: null,
      });
      continue;
    }

    // Margins drift slightly year over year so the series is not perfectly flat.
    const drift = (year - 2021) * 0.004;
    const yearGm = gm + drift;
    const yearOm = om + drift * 0.6;

    annual.push({
      fiscalYear: year,
      revenue,
      grossMargin: round(yearGm, 3),
      operatingIncome: round(revenue * yearOm),
      netIncome: round(revenue * yearOm * 0.74),
      freeCashFlow: round(revenue * yearOm * 0.61),
    });

    SEASONALITY.forEach((weight, i) => {
      quarterly.push({
        period: `FY${year} Q${i + 1}`,
        revenue: round(revenue * weight),
        grossMargin: round(yearGm + (i - 1.5) * 0.003, 3),
        operatingIncome: round(revenue * weight * yearOm),
      });
    });
  }

  return {
    company: company.name,
    ticker: company.ticker,
    currency: "USD",
    unit: "millions",
    annual,
    quarterly,
    provenance: {
      source: "internal-fundamentals-warehouse",
      ingestedAt: "2026-03-14T08:12:44Z",
      pipelineVersion: "fundamentals-etl@4.11.2",
      checksum: `sha256:${company.ticker.toLowerCase()}9f3c1a7b42e08d5601cc8ea7743bb2190d4f8e6a`,
      restatements: [
        {
          period: "FY2022",
          note: "Segment revenue reallocated following the FY2023 reporting-structure change; consolidated totals unaffected.",
        },
      ],
    },
    ...(company.name === "Initech"
      ? {
          warnings: [
            "FY2025 has not been filed yet; the 8-K dated 2026-01-30 gives preliminary revenue guidance only.",
            "FY2023 professional services revenue is unaudited.",
          ],
        }
      : {}),
  };
}

export const financials: FinancialRecord[] = companies.map(buildRecord);

export const documents: ResearchDocument[] = [
  {
    id: "DOC-ACME-001",
    company: "Acme Corp",
    form: "Earnings Call",
    title: "Acme Corp FY2025 Q4 earnings call — prepared remarks",
    date: "2026-02-18",
    body: "Full-year revenue came in at $2.26 billion, up 5.5% over FY2024. Control Systems grew high single digits as customers refreshed aging PLC installations, while Sensors and Instrumentation was roughly flat on soft automotive demand. Backlog finished the year at $1.1 billion, up modestly. We continue to see extended decision cycles among mid-market discrete manufacturers, and we are planning FY2026 on the assumption that this persists through at least the first half. Gross margin expanded 40 basis points on favorable mix and the Cleveland plant consolidation completed in the third quarter. We are guiding FY2026 revenue growth of 4 to 6 percent and expect operating margin to be broadly stable.",
  },
  {
    id: "DOC-ACME-002",
    company: "Acme Corp",
    form: "10-K Excerpt",
    title: "Acme Corp FY2025 10-K — risk factors excerpt",
    date: "2026-02-18",
    body: "Our results depend on capital spending by discrete manufacturers, which is cyclical and sensitive to interest rates. A prolonged downturn in automotive or general machinery production would reduce demand for our control and sensing products. We derive approximately 22% of revenue from our ten largest customers, and the loss of any one of them could have a material adverse effect. We also face increasing competition from lower-cost regional suppliers in Asia, and from robotics vendors bundling motion control into integrated cells, which may compress pricing in Control Systems over time.",
  },
  {
    id: "DOC-ACMR-001",
    company: "Acme Robotics",
    form: "Earnings Call",
    title: "Acme Robotics FY2025 Q4 earnings call — prepared remarks",
    date: "2026-03-04",
    body: "Revenue reached $1.015 billion in FY2025, growth of 47% year over year, and we crossed the billion-dollar mark two years ahead of the plan we laid out at IPO. Robotic Arms unit volume grew 39% and Software and Licensing grew 71%, now 29% of total revenue at substantially higher gross margin. Logistics customers were the largest driver; contract manufacturing was slower but stable. Operating margin remains thin at roughly 4% as we continue to invest in field service capacity, and we expect that to stay the case through FY2026. We are guiding FY2026 growth of 30 to 35 percent, a deliberate deceleration as the base grows and as we prioritize deployment quality over new logo count.",
  },
  {
    id: "DOC-ACMR-002",
    company: "Acme Robotics",
    form: "Press Release",
    title: "Acme Robotics announces expanded logistics partnership",
    date: "2025-11-12",
    body: "Acme Robotics today announced a three-year framework agreement with a top-five North American parcel operator covering the deployment of up to 4,000 collaborative arms across sortation facilities. The agreement includes a software subscription component priced per active arm. The company noted that revenue recognition will be weighted toward the second and third years of the agreement and that the arrangement carries volume-based pricing tiers that will modestly dilute hardware gross margin.",
  },
  {
    id: "DOC-GLBX-001",
    company: "Globex Inc",
    form: "Earnings Call",
    title: "Globex Inc FY2025 Q4 earnings call — prepared remarks",
    date: "2026-02-11",
    body: "Consolidated revenue of $8.9 billion was up 2.1% for the year. Building Products returned to growth after two soft years as residential activity recovered, Energy Equipment declined slightly on project timing, and Specialty Chemicals was roughly flat with better pricing offsetting lower volume. Organic growth was approximately 0.6%, with the balance from the two bolt-on acquisitions completed in the first half. We remain focused on portfolio simplification and expect to announce the divestiture of at least one non-core business in FY2026. Free cash flow conversion improved to 61% of operating income.",
  },
  {
    id: "DOC-GLBX-002",
    company: "Globex Inc",
    form: "10-K Excerpt",
    title: "Globex Inc FY2025 10-K — management discussion excerpt",
    date: "2026-02-11",
    body: "Revenue growth over the last three fiscal years has averaged approximately 1.9% annually, reflecting the mature end markets served by our segments and the drag from currency translation on our European operations. Management's stated capital allocation priority is margin expansion rather than top-line growth, and we have reduced the manufacturing footprint by eleven facilities since FY2022. Approximately 48% of FY2025 revenue was generated outside North America.",
  },
  {
    id: "DOC-ITCH-001",
    company: "Initech",
    form: "8-K",
    title: "Initech provides preliminary FY2025 results",
    date: "2026-01-30",
    body: "Initech today announced preliminary unaudited results for the fiscal year ended December 31, 2025. The company expects revenue of approximately $1.12 billion to $1.14 billion, representing growth of approximately 13% to 15% over FY2024. Subscription revenue is expected to represent approximately 68% of total revenue, up from 62% in FY2024. The company noted that its audit is ongoing and that its Form 10-K filing will be delayed beyond the customary deadline as it completes the review of revenue recognition for a set of multi-year contracts signed in the fourth quarter. Final results may differ materially from these preliminary estimates.",
  },
  {
    id: "DOC-ITCH-002",
    company: "Initech",
    form: "Earnings Call",
    title: "Initech FY2024 Q4 earnings call — prepared remarks",
    date: "2025-03-27",
    body: "FY2024 revenue of $988 million grew 14.8%, the third consecutive year of low-to-mid teens growth. Subscription revenue grew 26% while perpetual license declined 19% as expected under the transition. Net revenue retention was 112%. We continue to see mid-market financial institutions consolidating vendors, which favors our integrated suite. The principal risk to our plan remains the pace at which existing perpetual customers convert, and we have deliberately not pulled conversions forward with discounting.",
  },
  {
    id: "DOC-UMBR-001",
    company: "Umbrella Health",
    form: "Earnings Call",
    title: "Umbrella Health FY2025 Q4 earnings call — prepared remarks",
    date: "2026-02-26",
    body: "Revenue grew 9.6% to $4.4 billion. Clinic Operations added 34 locations, of which 27 came from the two regional acquisitions closed in the second and third quarters; same-clinic revenue growth was 3.1%. Pharmacy Benefits grew 12% on higher covered lives. Operating margin was 7.4%, down 20 basis points, reflecting integration costs and wage inflation in nursing. We expect FY2026 revenue growth of 8 to 10 percent with roughly half from acquisitions already under letter of intent.",
  },
  {
    id: "DOC-UMBR-002",
    company: "Umbrella Health",
    form: "10-K Excerpt",
    title: "Umbrella Health FY2025 10-K — segment and acquisition excerpt",
    date: "2026-02-26",
    body: "A substantial portion of our historical revenue growth has been attributable to acquisitions rather than organic expansion. In FY2025, acquisitions contributed approximately 6.5 percentage points of the 9.6% consolidated revenue growth. Our ability to sustain growth depends on identifying suitable clinic groups at acceptable valuations and integrating them without disruption to patient volumes. We are also exposed to changes in government reimbursement rates, which represented approximately 41% of Clinic Operations revenue in FY2025.",
  },
];
