import { FastifyInstance } from 'fastify'
import { config } from '../../config/index.js'

export async function authPlugin(server: FastifyInstance) {
  server.addHook('onRequest', async (request, reply) => {
    if (!config.apiKey) return

    const xApiKey = request.headers['x-api-key'] as string | undefined
    const authHeader = request.headers['authorization'] as string | undefined
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined

    const key = xApiKey || bearerToken

    if (key !== config.apiKey) {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })
}
