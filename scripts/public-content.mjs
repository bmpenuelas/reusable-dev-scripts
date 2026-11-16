// These checks are generic portability safeguards, not a complete secret scanner.
export function assertPortableText(text, label) {
  const absoluteHome = /(?:\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}|\/(?:Users|home)\/)[^\s"'`<>]+/iu
  if (absoluteHome.test(text)) throw new Error(`Machine-specific home path in ${label}`)
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/u.test(text)) throw new Error(`Private key material in ${label}`)
}
