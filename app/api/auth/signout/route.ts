import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const headersList = await headers()
  const origin = headersList.get('origin') ?? 'http://localhost:3000'

  return NextResponse.redirect(`${origin}/login`)
}
