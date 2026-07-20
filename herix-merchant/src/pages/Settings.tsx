import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import { settingsApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'

export default function Settings() {
  const { t } = useTranslation()
  const [brandName, setBrandName] = useState('')
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState(false)

  const { data: profile } = useQuery({
    queryKey: ['merchant-profile'],
    queryFn: () => settingsApi.profile().then((r) => r.data),
  })

  useEffect(() => {
    if (profile) {
      setBrandName(profile.brand_name || '')
      setEmail(profile.contact_email || '')
    }
  }, [profile])

  const saveMut = useMutation({
    mutationFn: () => settingsApi.updateProfile({ brand_name: brandName, contact_email: email }),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) },
  })

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('settings.title')} />

      <div className="p-7 flex-1">
        <div className="max-w-lg">
          <div className="rounded-2xl p-6" style={{ background: '#fff' }}>
            <div className="text-sm font-semibold mb-5">{t('settings.profile')}</div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">{t('settings.brandName')}</label>
                <input
                  type="text" value={brandName} onChange={(e) => setBrandName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">{t('settings.contactEmail')}</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                style={{ background: 'var(--primary)', color: '#fff' }}
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
              >
                {saveMut.isPending ? t('common.loading') : t('settings.saveProfile')}
              </button>
              {saved && <span className="text-xs" style={{ color: 'var(--success)' }}>已保存</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
