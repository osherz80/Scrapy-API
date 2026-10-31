/**
 * Frozen snapshot of Neuton-Back supermarket conversion on 2026-10-31.
 * Source: src/lib/supermarket/conversion.ts and productConversion.ts.
 * This file is the compatibility oracle for ProductResult. Do not "improve" it.
 */

export interface NeutonLine {
  rawName: string;
  rawMaterialName: string;
  rawSku: string;
  isSkuEnriched: boolean;
  quantity: number;
  rawSrcUnit: string;
  srcUnit: string | null;
  srcUnitAmount: number | null;
  baseUnit: string | null;
  baseUnitAmount: number | null;
  unitPrice: number;
  totalPrice: number;
  confidence: number | null;
}

export interface NeutonPrice {
  ItemPrice: string;
  Quantity: string;
  ItemCode: string;
  ItemName: string;
  UnitQty: string;
}

type BaseUnits = keyof typeof CONVERSION;

const CONVERSION = {
  g: { mg: 0.001, g: 1, kg: 1000, oz: 28.3495, lb: 453.592 },
  ml: { ml: 1, l: 1000, tsp: 4.92892, tbsp: 14.7868, cup: 236.588 },
  each: { each: 1, dozen: 12 },
};

const HEBREW_MASS_REGEX = {
  g: /(?:^|\s)(?:גרם|גרמ(?:ים)?|ג[״"']?),?(?!\p{L})/u,
  kg: /(?:^|\s)(?:קילוגרם|קילוגרמ(?:ים)?|ק["'״]?ג),?(?!\p{L})/u,
  mg: /(?:^|\s)(?:מיליגרם|מיליגרמ(?:ים)?|מ["'״]?ג),?(?!\p{L})/u,
};

const HEBREW_VOLUME_REGEX = {
  ml: /(?:^|\s)(?:מיליליטר(?:ים)?|מ["'י]?ל|סמ"ק|מל),?(?!\p{L})/u,
  l: /(?:^|\s)(?:ליטר(?:ים)?|ל),?(?!\p{L})/u,
  tsp: /(?:^|\s)(?:כפית|כפיות),?(?!\p{L})/u,
  tbsp: /(?:^|\s)(?:כף|כפות),?(?!\p{L})/u,
};

const HEBREW_EACH_REGEX = {
  each: /(?:^|\s)(?:יחיד(?:ה|ות)|יחד(?:ה|ות)|מארז(?:ים)?|יח['״"]?)[,]?(?!\p{L})/u,
};

const ENGLISH_MASS_REGEX = {
  g: /(?:^|\s)(?:g|gr|grams?)\.?,?(?![\p{L}\d])/iu,
  kg: /(?:^|\s)(?:kg|kgs|kilograms?)\.?,?(?![\p{L}\d])/iu,
  mg: /(?:^|\s)(?:mg|milligrams?)\.?,?(?![\p{L}\d])/iu,
  oz: /(?:^|\s)(?:oz|ounces?)\.?,?(?![\p{L}\d])/iu,
  lb: /(?:^|\s)(?:lbs?|pounds?)\.?,?(?![\p{L}\d])/iu,
};

const ENGLISH_VOLUME_REGEX = {
  ml: /(?:^|\s)(?:ml|millilit(?:er|re)s?)\.?,?(?![\p{L}\d])/iu,
  l: /(?:^|\s)(?:l|lit(?:er|re)s?)\.?,?(?![\p{L}\d])/iu,
  tsp: /(?:^|\s)(?:tsp|tsps|teaspoons?)\.?,?(?![\p{L}\d])/iu,
  tbsp: /(?:^|\s)(?:tbsp|tbsps|tbs|tablespoons?)\.?,?(?![\p{L}\d])/iu,
  cup: /cups?\.?,?(?![\p{L}\d])/iu,
};

const ENGLISH_EACH_REGEX = {
  each: /(?:^|\s)(?:each|ea|units?|pieces?|pcs?)\.?,?(?![\p{L}\d])/iu,
  dozen: /(?:^|\s)(?:dozens?|doz)\.?,?(?![\p{L}\d])/iu,
};

function addEnglishRegexes(hebrew: Record<string, RegExp>, english: Record<string, RegExp>) {
  const combined = { ...hebrew };
  for (const [unit, regex] of Object.entries(english)) {
    const hebrewRegex = hebrew[unit];
    combined[unit] = hebrewRegex
      ? new RegExp(`${hebrewRegex.source}|${regex.source}`, 'iu')
      : regex;
  }
  return combined;
}

const MASS_REGEX = addEnglishRegexes(HEBREW_MASS_REGEX, ENGLISH_MASS_REGEX);
const VOLUME_REGEX = addEnglishRegexes(HEBREW_VOLUME_REGEX, ENGLISH_VOLUME_REGEX);
const EACH_REGEX = addEnglishRegexes(HEBREW_EACH_REGEX, ENGLISH_EACH_REGEX);

const measuresRegexes = {
  mass: MASS_REGEX,
  volume: VOLUME_REGEX,
  each: EACH_REGEX,
};

const BASE_UNIT = { mass: 'g', volume: 'ml', each: 'each' } as const;

export const getBaseAndCurrentUnit = (input: string) => {
  const categories = Object.keys(measuresRegexes) as Array<keyof typeof measuresRegexes>;
  for (const category of categories) {
    for (const [unit, regex] of Object.entries(measuresRegexes[category])) {
      if (regex.test(input)) return { current: unit, base: BASE_UNIT[category] };
    }
  }
  return { current: input, base: null };
};

function getScoredUnits(itemEnrichment: NeutonPrice[], item: NeutonLine) {
  const scoredUnits: { base: Record<string, number>; current: Record<string, number> } = {
    base: {},
    current: {},
  };
  const recordScore = (found: { current: string; base: string | null } | null) => {
    if (!found) return;
    if (found.base) scoredUnits.base[found.base] = (scoredUnits.base[found.base] || 0) + 1;
    if (found.current) scoredUnits.current[found.current] = (scoredUnits.current[found.current] || 0) + 1;
  };
  if (item.srcUnit) recordScore(getBaseAndCurrentUnit(item.srcUnit));
  if (item.baseUnit) recordScore(getBaseAndCurrentUnit(item.baseUnit));
  for (const enrichmentItem of itemEnrichment) {
    if (enrichmentItem.UnitQty) recordScore(getBaseAndCurrentUnit(enrichmentItem.UnitQty));
  }
  const getMaxEntry = (record: Record<string, number>): string | null =>
    Object.entries(record).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
  return { base: getMaxEntry(scoredUnits.base), current: getMaxEntry(scoredUnits.current) };
}

function setSrcUnitAmount(enrichedList: Array<{ item: NeutonLine; itemEnrichment: NeutonPrice[] | null }>) {
  return enrichedList.map(({ item, itemEnrichment }) => {
    item.srcUnitAmount = itemEnrichment?.[0]?.Quantity ? +itemEnrichment[0].Quantity : null;
    return { item, itemEnrichment };
  });
}

export const setUnitsData = (
  enrichedList: Array<{ item: NeutonLine; itemEnrichment: NeutonPrice[] | null }>,
) => {
  enrichedList.map(({ item, itemEnrichment }) => {
    let foundUnits;
    if (itemEnrichment?.[0]) {
      foundUnits = item.isSkuEnriched
        ? getBaseAndCurrentUnit(itemEnrichment[0].UnitQty)
        : getScoredUnits(itemEnrichment, item);
    } else {
      foundUnits = item.srcUnit ? getBaseAndCurrentUnit(item.srcUnit) : null;
    }
    item.baseUnit = foundUnits?.base ?? null;
    item.srcUnit = foundUnits?.current ?? item.srcUnit;
    return { item, itemEnrichment };
  });
  const listWithAmounts = setSrcUnitAmount(enrichedList);
  listWithAmounts.forEach(({ item }) => {
    convertSrcAmountToBase(item);
  });
  return listWithAmounts;
};

export const convertSrcAmountToBase = <T extends Pick<NeutonLine, 'srcUnit' | 'srcUnitAmount' | 'baseUnit' | 'baseUnitAmount'>>(
  item: T,
): T => {
  const { srcUnit, srcUnitAmount, baseUnit } = item;
  if (!srcUnit || !srcUnitAmount || !baseUnit) return item;
  const conversions: Record<string, number> | undefined = CONVERSION[baseUnit as BaseUnits];
  const ratio = conversions?.[srcUnit] ?? null;
  item.baseUnitAmount = ratio ? srcUnitAmount * ratio : null;
  return item;
};

function positiveDecimal(value: string, allowZero = false): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && (amount > 0 || (allowZero && amount === 0)) ? amount : null;
}

export function normalizeProductPrice(product: NeutonPrice, rawMaterialName: string) {
  const price = positiveDecimal(product.ItemPrice, true);
  if (
    price === null ||
    positiveDecimal(product.Quantity) === null ||
    !product.ItemCode.trim() ||
    !product.ItemName.trim()
  ) {
    return null;
  }
  const item: NeutonLine = {
    rawName: product.ItemName,
    rawMaterialName,
    rawSku: product.ItemCode.trim(),
    isSkuEnriched: true,
    quantity: 1,
    rawSrcUnit: product.UnitQty,
    srcUnit: null,
    srcUnitAmount: null,
    baseUnit: null,
    baseUnitAmount: null,
    unitPrice: price,
    totalPrice: price,
    confidence: null,
  };
  setUnitsData([{ item, itemEnrichment: [product] }]);
  const baseAmount = item.baseUnitAmount;
  if (baseAmount === null || !Number.isFinite(baseAmount) || baseAmount <= 0 || baseAmount >= 1e21) return null;
  const cost = price / baseAmount;
  if (!Number.isFinite(cost) || cost >= 1e12) return null;
  const baseUnitAmount = baseAmount.toFixed(3);
  const baseUnitCost = cost.toFixed(6);
  if (
    Number(baseUnitAmount) <= 0 ||
    (price > 0 && Number(baseUnitCost) <= 0) ||
    Number(baseUnitCost) >= 1e12
  ) {
    return null;
  }
  return {
    rawName: item.rawName,
    sku: item.rawSku,
    rawMaterialName,
    rawSrcUnit: item.rawSrcUnit,
    srcUnit: item.srcUnit,
    baseUnit: item.baseUnit,
    baseUnitAmount,
    baseUnitCost,
  };
}
