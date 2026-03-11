'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

const sourceTypeOptions = [
  { value: '', label: 'All Sources' },
  { value: 'local', label: 'Local' },
  { value: 'external', label: 'External' },
  { value: 'mac', label: 'Mac' },
  { value: 'docker', label: 'Docker' },
]

const printMethodOptions = [
  { value: '', label: 'All Methods' },
  { value: 'DTG', label: 'DTG' },
  { value: 'SUBLIMATION', label: 'Sublimation' },
  { value: 'EMBROIDERY', label: 'Embroidery' },
  { value: 'UV', label: 'UV' },
  { value: 'ALL_OVER_PRINT', label: 'All Over Print' },
  { value: 'PRINTED', label: 'Printed' },
  { value: 'KNITTED', label: 'Knitted' },
]

export function AnalyticsFilters() {
  const router = useRouter()
  const params = useSearchParams()

  function updateParam(key: string, value: string) {
    const sp = new URLSearchParams(params.toString())
    if (value) {
      sp.set(key, value)
    } else {
      sp.delete(key)
    }
    router.push(`/analytics?${sp.toString()}`)
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Input
        placeholder="Server URL..."
        className="w-64"
        defaultValue={params.get('server_url') || ''}
        onChange={(e) => updateParam('server_url', e.target.value)}
      />
      <Select
        options={sourceTypeOptions}
        value={params.get('source_type') || ''}
        onChange={(e) => updateParam('source_type', e.target.value)}
      />
      <Select
        options={printMethodOptions}
        value={params.get('print_method') || ''}
        onChange={(e) => updateParam('print_method', e.target.value)}
      />
      <Input
        type="date"
        className="w-40"
        defaultValue={params.get('from') || ''}
        onChange={(e) => updateParam('from', e.target.value)}
      />
      <Input
        type="date"
        className="w-40"
        defaultValue={params.get('to') || ''}
        onChange={(e) => updateParam('to', e.target.value)}
      />
    </div>
  )
}
