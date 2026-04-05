import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Ctx = { params: Promise<{ companyId: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const supabase = await createClient()
  const { companyId } = await params

  const { data, error } = await supabase
    .from('cim_documents')
    .select('*')
    .eq('company_id', companyId)
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const supabase = await createClient()
  const { companyId } = await params

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const filePath = `${companyId}/${Date.now()}_${file.name}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabase.storage
    .from('cim-documents')
    .upload(filePath, buffer, {
      contentType: file.type || 'application/pdf',
      upsert: false,
    })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data, error: insertError } = await supabase
    .from('cim_documents')
    .insert({
      company_id: companyId,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const supabase = await createClient()
  const { companyId } = await params

  const { searchParams } = new URL(req.url)
  const docId = searchParams.get('docId')
  const filePath = searchParams.get('filePath')

  if (!docId || !filePath)
    return NextResponse.json({ error: 'docId and filePath are required' }, { status: 400 })

  await supabase.storage.from('cim-documents').remove([filePath])

  const { error } = await supabase
    .from('cim_documents')
    .delete()
    .eq('id', docId)
    .eq('company_id', companyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
