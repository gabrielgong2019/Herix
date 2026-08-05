import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Check } from 'lucide-react'

const INDUSTRY_IDS = ['finance', 'beauty', 'fashion', 'food', 'travel', 'baby', 'ecommerce', 'other']

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
            style={
              i < step
                ? { background: 'var(--primary)', color: '#fff' }
                : i === step
                ? { background: 'var(--primary)', color: '#fff' }
                : { background: '#e5e7eb', color: 'var(--muted)' }
            }
          >
            {i < step ? <Check size={14} /> : i + 1}
          </div>
          {i < total - 1 && (
            <div
              className="w-10 h-0.5"
              style={{ background: i < step ? 'var(--primary)' : '#e5e7eb' }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default function Onboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, loading, refreshUser } = useAuth()
  const [step, setStep] = useState(0)

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  if (user.brand_onboarded) return <Navigate to="/" replace />

  const [isAgency, setIsAgency] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [industry, setIndustry] = useState('')
  const [website, setWebsite] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [companyDesc, setCompanyDesc] = useState('')
  const [agreed, setAgreed] = useState(false)

  const submitMut = useMutation({
    mutationFn: () =>
      authApi.onboard({
        companyName,
        industry: industry || undefined,
        website: website || undefined,
        contactName,
        contactPhone: contactPhone || undefined,
        billingEmail: billingEmail || undefined,
        companyDesc: companyDesc || undefined,
        isAgency,
        agreedToTerms: agreed,
      }),
    onSuccess: async (res) => {
      // 若后端检测到角色缺失，会随 onboard 响应附带含 BRAND 的新 token，需立即更换存储
      const newToken = (res?.data as any)?.token
      if (newToken) localStorage.setItem('herix-merchant-token', newToken)
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['merchant-profile'] })
      navigate('/tasks/new?from=onboard', { replace: true })
    },
  })

  function inputCls() {
    return 'w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-shadow focus:ring-2'
  }
  const inputStyle = { border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }

  const steps = [
    t('onboard.step1Title'),
    t('onboard.step2Title'),
    t('onboard.step3Title'),
    t('onboard.step4Title'),
  ]

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--bg)' }}
    >
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold mb-1">{t('onboard.title')}</div>
        </div>

        <div className="rounded-2xl p-8" style={{ background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
          <StepIndicator step={step} total={4} />

          <div className="text-base font-semibold mb-5">{steps[step]}</div>

          {/* Step 0 — Account type */}
          {step === 0 && (
            <div className="space-y-3">
              {[
                { value: false, label: t('onboard.isBrand'), desc: t('onboard.isBrandDesc') },
                { value: true, label: t('onboard.isAgency'), desc: t('onboard.isAgencyDesc') },
              ].map((opt) => (
                <button
                  key={String(opt.value)}
                  className="w-full text-left rounded-xl p-4 transition-all"
                  style={{
                    border: `2px solid ${isAgency === opt.value ? 'var(--primary)' : 'var(--border)'}`,
                    background: isAgency === opt.value ? '#f0f9ff' : '#fff',
                  }}
                  onClick={() => setIsAgency(opt.value)}
                >
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          )}

          {/* Step 1 — Company info */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('onboard.companyName')} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className={inputCls()}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('onboard.industry')}
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle}
                >
                  <option value="">{t('settings.industryPh')}</option>
                  {INDUSTRY_IDS.map((id) => (
                    <option key={id} value={id}>{t(`industry.${id}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('onboard.website')}
                </label>
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://"
                  className={inputCls()}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('onboard.companyDesc')}
                </label>
                <textarea
                  value={companyDesc}
                  onChange={(e) => setCompanyDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
                  style={inputStyle}
                />
              </div>
            </div>
          )}

          {/* Step 2 — Contact */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('onboard.contactName')} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className={inputCls()}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('onboard.contactPhone')}
                </label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className={inputCls()}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                  {t('onboard.billingEmail')}
                </label>
                <input
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  placeholder="accounting@company.com"
                  className={inputCls()}
                  style={inputStyle}
                />
              </div>
            </div>
          )}

          {/* Step 3 — Agreement */}
          {step === 3 && (
            <div className="space-y-4">
              <div
                className="rounded-xl p-4 text-xs leading-relaxed overflow-y-auto"
                style={{ background: '#f8fafc', border: '1px solid var(--border)', color: 'var(--muted)', maxHeight: '240px', whiteSpace: 'pre-wrap' }}
              >
                {t('onboard.agreeContent')}
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 rounded"
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span className="text-sm">{t('onboard.agreeText')}</span>
              </label>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {t('onboard.agreeHint')}
              </div>
              {submitMut.isError && (
                <div className="text-xs" style={{ color: '#dc2626' }}>{t('onboard.submitFailed')}</div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8">
            <button
              className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-0"
              style={{ background: '#f3f4f6', color: 'var(--text)' }}
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
            >
              {t('onboard.prev')}
            </button>

            {step < 3 ? (
              <button
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--primary)' }}
                onClick={() => setStep((s) => s + 1)}
                disabled={
                  (step === 1 && !companyName.trim()) ||
                  (step === 2 && !contactName.trim())
                }
              >
                {t('onboard.next')}
              </button>
            ) : (
              <button
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--primary)' }}
                onClick={() => submitMut.mutate()}
                disabled={!agreed || submitMut.isPending}
              >
                {submitMut.isPending ? t('onboard.submitting') : t('onboard.submit')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
