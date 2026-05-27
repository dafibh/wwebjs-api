// Lazy env accessors so a missing var only throws when actually used
// (not at build/import time).
function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export const config = {
  get databaseUrl() { return req('DATABASE_URL') },
  get jwtSecret() { return req('JWT_SECRET') },
  get adminUser() { return req('ADMIN_USER') },
  get adminPasswordHash() { return req('ADMIN_PASSWORD_HASH') },
  get wwebjsBaseUrl() { return req('WWEBJS_BASE_URL') },
  get wwebjsApiKey() { return req('WWEBJS_GLOBAL_API_KEY') }
}
