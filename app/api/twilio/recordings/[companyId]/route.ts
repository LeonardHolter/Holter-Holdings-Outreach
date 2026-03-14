import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('call_recordings')
    .select('id, call_sid, caller_name, recording_url, duration_seconds, called_at, called_by')
    .eq('company_id', companyId)
    .order('called_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
