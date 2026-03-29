export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Company, CompanyNote, CallRecording } from '@/types'
import { Nav } from '@/components/Nav'
import LeadDetailClient from '@/components/LeadDetailClient'

async function fetchLead(id: string): Promise<Company | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('companies').select('*').eq('id', id).single()
  return (data as Company) ?? null
}

async function fetchRecordings(companyId: string): Promise<CallRecording[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('call_recordings')
    .select('id, company_id, call_sid, caller_name, recording_url, duration_seconds, called_at, called_by')
    .eq('company_id', companyId)
    .order('called_at', { ascending: false })
    .limit(20)
  return (data as CallRecording[]) ?? []
}

async function fetchNotes(companyId: string): Promise<CompanyNote[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('company_notes')
    .select('id, company_id, note, caller_name, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data as CompanyNote[]) ?? []
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [lead, recordings, notes] = await Promise.all([
    fetchLead(id),
    fetchRecordings(id),
    fetchNotes(id),
  ])

  if (!lead) notFound()

  const streamRecordings = recordings.map(r => ({
    ...r,
    streamUrl: r.recording_url
      ? `/api/twilio/recordings/stream?url=${encodeURIComponent(r.recording_url)}`
      : null,
  }))

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-y-auto">
        <LeadDetailClient lead={lead} recordings={streamRecordings} notes={notes} />
      </div>
    </div>
  )
}
