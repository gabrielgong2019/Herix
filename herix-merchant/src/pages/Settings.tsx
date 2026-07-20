import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { Upload } from 'lucide-react'

const INDUSTRY_IDS = ['finance', 'beauty', 'fashion', 'food', 'travel', 'baby', 'ecommerce', 'other']

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
        {label}{hint && <span className="font-normal ml-1" style={{ color: 'var(--muted)' }}>{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-shadow focus:ring-2"
      style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
    />
  )
}

function BrandImageSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const logoRef = useRef<HTMLInputElement>(null)
  const promoRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ type: 'logo' | 'promo'; text: string; ok: boolean } | null>(null)

  const { data: profile } = useQuery({
    queryKey: ['merchant-profile'],
    queryFn: () => settingsApi.profile().then((r) => r.data),
  })

  const uploadMut = useMutation({
    mutationFn: ({ type, file }: { type: 'logo' | 'promo'; file: File }) =>
      settingsApi.uploadBrandAsset(type, file),
    onSuccess: (_, vars) => {
      setMsg({ type: vars.type, text: t('settings.saveSuccess'), ok: true })
      qc.invalidateQueries({ queryKey: ['merchant-profile'] })
    },
    onError: (_, vars) => {
      setMsg({ type: vars.type, text: t('settings.imageUploadFailed'), ok: false })
    },
  })

  function handleFile(type: 'logo' | 'promo', file: File | undefined) {
    if (!file) return
    setMsg(null)
    uploadMut.mutate({ type, file })
  }

  function ImageSlot({ assetType, label, hint, url }: { assetType: 'logo' | 'promo'; label: string; hint: string; url?: string }) {
    const fileRef = assetType === 'logo' ? logoRef : promoRef
    const pending = uploadMut.isPending && uploadMut.variables?.type === assetType
    return (
      <div>
        <div className="text-xs font-medium mb-1.5" style={{ color: '#374151' }}>{label}</div>
        <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>{hint}</div>
        <div className="flex items-center gap-3">
          {url ? (
            <img
              src={url}
              alt={label}
              className="w-16 h-16 rounded-xl object-cover border"
              style={{ borderColor: 'var(--border)' }}
            />
          ) : (
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-xs"
              style={{ background: '#f3f4f6', border: '1px dashed var(--border)', color: 'var(--muted)' }}
            >
              {t('settings.notSet')}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={(e) => handleFile(assetType, e.target.files?.[0])}
          />
          <button
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl font-medium disabled:opacity-50"
            style={{ background: '#f3f4f6', color: 'var(--text)' }}
            onClick={() => fileRef.current?.click()}
            disabled={pending}
          >
            <Upload size={12} />
            {pending ? t('settings.uploadingImage') : t('common.edit')}
          </button>
        </div>
        {msg?.type === assetType && (
          <div className="mt-2 text-xs" style={{ color: msg.ok ? 'var(--success)' : '#dc2626' }}>
            {msg.text}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-6" style={{ background: '#fff' }}>
      <div className="text-sm font-semibold mb-5">{t('settings.brandImage')}</div>
      <div className="grid grid-cols-2 gap-6">
        <ImageSlot
          assetType="logo"
          label={t('settings.logoLabel')}
          hint={t('settings.logoHint')}
          url={profile?.brand_logo_url}
        />
        <ImageSlot
          assetType="promo"
          label={t('settings.promoLabel')}
          hint={t('settings.promoHint')}
          url={profile?.brand_promo_image_url}
        />
      </div>
    </div>
  )
}

function KybSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [kybMsg, setKybMsg] = useState('')

  const { data: profile } = useQuery({
    queryKey: ['merchant-profile'],
    queryFn: () => settingsApi.profile().then((r) => r.data),
  })

  const uploadMut = useMutation({
    mutationFn: (file: File) => settingsApi.uploadKybDoc(file),
    onSuccess: () => {
      setKybMsg(t('kyb.submitted'))
      qc.invalidateQueries({ queryKey: ['merchant-profile'] })
    },
    onError: () => setKybMsg(t('kyb.uploadFailed')),
  })

  const status = profile?.kyb_status || 'none'

  return (
    <div className="rounded-2xl p-6" style={{ background: '#fff' }}>
      <div className="text-sm font-semibold mb-4">{t('kyb.title')}</div>

      {status === 'approved' && (
        <div>
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold mb-2"
            style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}
          >
            {t('kyb.approved')}
          </div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>{t('kyb.approvedHint')}</div>
        </div>
      )}

      {status === 'pending' && (
        <div>
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold mb-2"
            style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
          >
            {t('kyb.pending')}
          </div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>{t('kyb.pendingHint')}</div>
        </div>
      )}

      {(status === 'none' || status === 'rejected') && (
        <div>
          {status === 'rejected' && profile?.kyb_reject_reason && (
            <div
              className="rounded-xl px-3 py-2 mb-3 text-xs"
              style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
            >
              {t('kyb.rejectedPrefix')}{profile.kyb_reject_reason}
            </div>
          )}
          <p className="text-xs mb-4" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>{t('kyb.benefit')}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) { setKybMsg(''); uploadMut.mutate(f) }
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadMut.isPending}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ background: 'var(--primary)' }}
          >
            {uploadMut.isPending ? t('kyb.uploading') : t('kyb.upload')}
          </button>
          {kybMsg && (
            <div
              className="mt-3 text-xs rounded-xl px-3 py-2"
              style={{
                background: uploadMut.isError ? '#fef2f2' : '#f0fdf4',
                border: `1px solid ${uploadMut.isError ? '#fecaca' : '#bbf7d0'}`,
                color: uploadMut.isError ? '#dc2626' : '#15803d',
              }}
            >
              {kybMsg}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [companyName, setCompanyName]   = useState('')
  const [industry, setIndustry]         = useState('')
  const [website, setWebsite]           = useState('')
  const [contactName, setContactName]   = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [companyDesc, setCompanyDesc]   = useState('')
  const [saved, setSaved] = useState(false)

  const { data: profile } = useQuery({
    queryKey: ['merchant-profile'],
    queryFn: () => settingsApi.profile().then((r) => r.data),
  })

  useEffect(() => {
    if (!profile) return
    setCompanyName(profile.company_name || profile.brand_name || '')
    setIndustry(profile.industry || '')
    setWebsite(profile.website || '')
    setContactName(profile.contact_name || '')
    setContactPhone(profile.contact_phone || '')
    setBillingEmail(profile.brand_billing_email || profile.contact_email || '')
    setCompanyDesc(profile.company_desc || '')
  }, [profile])

  const saveMut = useMutation({
    mutationFn: () =>
      settingsApi.updateProfile({ companyName, industry, website, contactName, contactPhone, billingEmail, companyDesc }),
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      qc.invalidateQueries({ queryKey: ['merchant-profile'] })
    },
  })

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('settings.title')} />

      <div className="p-7 flex-1">
        <div className="max-w-2xl space-y-4">

          {profile?.is_agency && (
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold"
              style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#c2410c' }}
            >
              {t('settings.agencyBadge')}
              <span className="font-normal text-xs" style={{ color: '#9a3412' }}>· {t('settings.agencyBadgeSub')}</span>
            </div>
          )}

          {/* Brand info */}
          <div className="rounded-2xl p-6" style={{ background: '#fff' }}>
            <div className="text-sm font-semibold mb-5">{t('settings.profile')}</div>

            <div className="grid grid-cols-2 gap-4">
              <Field label={t('settings.companyName')}>
                <Input value={companyName} onChange={setCompanyName} placeholder={t('settings.companyNamePh')} />
              </Field>

              <Field label={t('settings.industry')}>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
                >
                  <option value="" disabled>{t('settings.industryPh')}</option>
                  {INDUSTRY_IDS.map((id) => (
                    <option key={id} value={id}>{t(`industry.${id}`)}</option>
                  ))}
                </select>
              </Field>

              <Field label={t('settings.website')}>
                <Input value={website} onChange={setWebsite} placeholder={t('settings.websitePh')} />
              </Field>

              <Field label={t('settings.contactName')}>
                <Input value={contactName} onChange={setContactName} />
              </Field>

              <Field label={t('settings.contactPhone')}>
                <Input value={contactPhone} onChange={setContactPhone} type="tel" />
              </Field>

              <Field label={t('settings.billingEmail')} hint={t('settings.billingEmailHint')}>
                <Input value={billingEmail} onChange={setBillingEmail} type="email" placeholder={t('settings.billingEmailPh')} />
              </Field>

              <div className="col-span-2">
                <Field label={t('settings.companyDesc')}>
                  <textarea
                    value={companyDesc}
                    onChange={(e) => setCompanyDesc(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-y"
                    style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
                  />
                </Field>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: 'var(--primary)' }}
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
              >
                {saveMut.isPending ? t('common.loading') : t('settings.saveProfile')}
              </button>
              {saveMut.isError && (
                <span className="text-xs" style={{ color: '#dc2626' }}>
                  {(saveMut.error as any)?.response?.data?.error || t('settings.saveFailed')}
                </span>
              )}
              {saved && <span className="text-xs" style={{ color: 'var(--success)' }}>{t('settings.saveSuccess')}</span>}
            </div>
          </div>

          {/* Brand images */}
          <BrandImageSection />

          {/* KYB */}
          <KybSection />

        </div>
      </div>
    </div>
  )
}
