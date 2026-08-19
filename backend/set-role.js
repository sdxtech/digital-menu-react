const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')

const [,, emailArg, rolesArg] = process.argv

if (!emailArg || !rolesArg) {
  console.log('Usage: node backend/set-role.js <email> <roles>')
  console.log('Example: node backend/set-role.js unit@brand.com unit-manager')
  console.log('Example: node backend/set-role.js super@brand.com superadmin')
  process.exit(1)
}

const allowedRoles = new Set([
  'superadmin',
  'chef',
  'unit-manager',
  'admin-site',
  'storekeeper',
])

const roles = rolesArg
  .split(',')
  .map((role) => role.trim())
  .filter(Boolean)

const invalidRoles = roles.filter((role) => !allowedRoles.has(role))
if (invalidRoles.length) {
  console.error(`Invalid roles: ${invalidRoles.join(', ')}`)
  console.error(`Allowed roles: ${Array.from(allowedRoles).join(', ')}`)
  process.exit(1)
}

const parseEnvFile = (content) => {
  const env = {}
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const splitAt = trimmed.indexOf('=')
    if (splitAt === -1) return
    const key = trimmed.slice(0, splitAt).trim()
    let value = trimmed.slice(splitAt + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  })
  return env
}

const resolveMongoUri = () => {
  if (process.env.MONGO_URI) return process.env.MONGO_URI
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) return null
  const env = parseEnvFile(fs.readFileSync(envPath, 'utf8'))
  return env.MONGO_URI || null
}

const run = async () => {
  const mongoUri = resolveMongoUri()
  if (!mongoUri) {
    console.error('MONGO_URI not found. Set it in backend/.env or env vars.')
    process.exit(1)
  }

  await mongoose.connect(mongoUri)
  const users = mongoose.connection.collection('users')
  const email = emailArg.toLowerCase().trim()
  const result = await users.updateOne(
    { email },
    { $set: { roles } },
  )

  if (!result.matchedCount) {
    console.error(`User not found: ${email}`)
  } else {
    console.log(`Updated roles for ${email}: ${roles.join(', ')}`)
  }

  await mongoose.disconnect()
}

run().catch((error) => {
  console.error('Failed to update roles.')
  console.error(error)
  process.exit(1)
})
