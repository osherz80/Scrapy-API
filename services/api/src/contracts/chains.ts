export const CHAIN_IDS = [
  'shufersal',
  'carrefour',
  'rami-levy',
  'yochananof',
  'osher-ad',
  'victory',
  'mahsanei-hashuk',
  'hatzi-hinam',
  'tiv-taam',
  'keshet-teamim',
] as const;

export type ChainId = (typeof CHAIN_IDS)[number];

export function isChainId(value: string): value is ChainId {
  return (CHAIN_IDS as readonly string[]).includes(value);
}
