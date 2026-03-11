import type { FastifyInstance } from 'fastify'
import { fourthwallApi } from '../../services/FourthwallApiService.js'
import { logger } from '../../logger/index.js'

export async function generatorRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/resolve', {
    schema: { tags: ['Generators'] },
  }, async (request, reply) => {
    const { productSlug, generatorId, productType, productQuery } = request.query as Record<string, string | undefined>

    const result = await fourthwallApi.resolveGenerator({
      productSlug,
      generatorId,
      productType: productType as any,
      productQuery,
    })

    return result
  })
}
