export const demoEmail = 'responder@pharos.com'
const demo = { salt: '541a7bf90f22b6ac1489ee02f037a54d', hash: 'cc51b7cc527d93d9a285dd89f1ae2a6e4b812f204bacfda61dd040df3cb6f2cb' }
export function accountEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a valid email address.')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.')
  return email
}
function hex(bytes: Uint8Array): string { return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('') }
export async function passwordRecord(password: unknown, salt = hex(crypto.getRandomValues(new Uint8Array(16)))): Promise<{salt:string;hash:string}> {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new Error('Use a password of 8–128 characters.')
  if (!/^[a-f0-9]{32}$/.test(salt)) throw new Error('Invalid account record.')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const hash = hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt.match(/../g)!, b=>parseInt(b,16)),iterations:100000},key,256)))
  return {salt,hash}
}
export async function passwordMatches(password: unknown, record: {salt:string;hash:string} | null): Promise<boolean> {
  try {
    const actual = await passwordRecord(password, (record || demo).salt)
    const expected = (record || demo).hash
    let diff = actual.hash.length ^ expected.length
    for(let i=0;i<actual.hash.length;i++) diff |= actual.hash.charCodeAt(i) ^ expected.charCodeAt(i)
    return Boolean(record) && diff === 0
  } catch { return false }
}
export const demoPasswordRecord = demo
