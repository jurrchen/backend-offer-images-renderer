'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ErrorAnalyticsRow } from '@fourthwall/shared'
import { format } from 'date-fns'

interface Props {
  data: ErrorAnalyticsRow[]
}

export function ErrorTable({ data }: Props) {
  const sorted = [...data].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent Errors</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[400px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Service</th>
                <th className="pb-2 pr-4">Endpoint</th>
                <th className="pb-2 pr-4">Category</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.id} className="border-b border-border/50">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {format(new Date(row.timestamp), 'MM/dd HH:mm:ss')}
                  </td>
                  <td className="py-2 pr-4">{row.service}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{row.endpoint}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {row.error_category}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{row.status_code}</td>
                  <td className="py-2 max-w-[300px] truncate" title={row.error_message}>
                    {row.error_message}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    No errors recorded
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
