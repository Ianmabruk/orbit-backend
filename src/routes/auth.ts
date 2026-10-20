import { FastifyInstance } from 'fastify'
import { z } from 'zod'

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (request, reply) => {
    const body = z.object({
      fullName: z.string().min(2),
      businessName: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
    }).parse(request.body)

    const token = app.jwt.sign({
      sub: 'demo-user',
      email: body.email,
      businessName: body.businessName,
      fullName: body.fullName,
    })

    return reply.code(201).send({
      token,
      user: {
        email: body.email,
        fullName: body.fullName,
        businessName: body.businessName,
      },
    })
  })

  app.post('/auth/login', async (request, reply) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(8),
    }).parse(request.body)

    if (body.email !== 'demo@example.com' || body.password !== 'DemoPass123') {
      return reply.code(401).send({ message: 'Invalid credentials' })
    }

    const token = app.jwt.sign({
      sub: 'demo-user',
      email: body.email,
      businessName: 'Northwind Services',
      fullName: 'Demo User',
    })

    return {
      token,
      user: {
        email: body.email,
        fullName: 'Demo User',
        businessName: 'Northwind Services',
      },
    }
  })
}
