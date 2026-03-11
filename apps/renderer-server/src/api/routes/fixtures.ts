import type { FastifyInstance } from 'fastify'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export async function fixtureRoutes(fastify: FastifyInstance): Promise<void> {
  const fixturesDir = path.join(process.cwd(), 'fixtures')

  fastify.get('/', {
    schema: { tags: ['Fixtures'] },
  }, async (request, reply) => {
    try {
      const files = await readdir(fixturesDir)
      const names = files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))
      return names
    } catch {
      return reply.code(500).send({ error: 'Failed to list fixtures' })
    }
  })

  fastify.get('/:name', {
    schema: { tags: ['Fixtures'] },
  }, async (request, reply) => {
    try {
      const { name } = request.params as { name: string }
      const filePath = path.join(fixturesDir, `${name}.json`)
      const data = await readFile(filePath, 'utf-8')
      return JSON.parse(data)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        const { name } = request.params as { name: string }
        return reply.code(404).send({ error: `Fixture "${name}" not found` })
      }
      return reply.code(500).send({ error: 'Failed to read fixture' })
    }
  })
}
