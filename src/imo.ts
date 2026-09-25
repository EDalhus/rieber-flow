/** IMO-nummer: 7 siffer der siste siffer er kontrollsiffer (vekter 7..2 på de seks første). */
export function gyldigImo(s: string | null | undefined): boolean {
  if (!s || !/^\d{7}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(s[i]) * (7 - i);
  return sum % 10 === Number(s[6]);
}
