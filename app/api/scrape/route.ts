import { NextRequest } from 'next/server'
import { scrapeState, STATE_BOUNDS } from '@/lib/scraper'
import type { ScrapeProgress } from '@/lib/scraper'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const { state } = (await request.json()) as { state: string }

  if (!state || !STATE_BOUNDS[state]) {
    return new Response(JSON.stringify({ error: `Invalid state: ${state}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GOOGLE_MAPS_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: ScrapeProgress) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const { results } = await scrapeState(state, apiKey, send)

        // Upsert into Supabase
        const supabase = await createClient()
        const records = [...results.values()].map(r => ({
          company_name: r.company_name,
          google_place_id: r.google_place_id,
          address: r.address,
          state: r.state,
          county: r.county,
          phone_number: r.phone_number,
          website: r.website,
          google_rating: r.google_rating,
          google_reviews: r.google_reviews,
          latitude: r.latitude,
          longitude: r.longitude,
          reach_out_response: 'Not called',
        }))

        const BATCH = 100
        let upserted = 0
        for (let i = 0; i < records.length; i += BATCH) {
          const batch = records.slice(i, i + BATCH)
          const { error } = await supabase
            .from('companies')
            .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })
          if (!error) upserted += batch.length
        }

        send({ type: 'done', total: results.size, newCompanies: upserted })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
