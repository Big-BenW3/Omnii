/** Solana Explorer links. Concord V1 is Devnet-only. */
export function explorerUrl(kind: "address" | "tx", value: string) {
  return `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
}

export function short(str: string, chars = 4): string {
  if (str.length <= chars * 2 + 3) return str;
  return `${str.slice(0, chars)}…${str.slice(-chars)}`;
}
