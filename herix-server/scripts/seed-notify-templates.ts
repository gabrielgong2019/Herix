/**
 * 通知模板 seed —— notify.TYPE.title / notify.TYPE.body
 *
 * 覆盖 zh/en/ja/vi（赫使端）和 zh/en/ja/ko（商家端）。
 * 变量用 {{var}} 语法，运行时由 notify.ts 插值。
 * 幂等：只覆盖 updated_by='seed' 的行（运营手动改过的不覆盖）。
 *
 * 用法: cd herix-server && npx tsx scripts/seed-notify-templates.ts
 */
import 'dotenv/config';
import pool from '../src/db';

type Locales = 'zh' | 'en' | 'ja' | 'vi' | 'ko';
type Templates = Record<string, Partial<Record<Locales, string>>>;

// ─── Herald-facing templates (zh / en / ja / vi) ───────────────────────────

const HERALD: Templates = {
  'notify.APP_APPROVED.title': {
    zh: '报名通过：{{task}}',
    en: 'Application approved: {{task}}',
    ja: '応募承認：{{task}}',
    vi: 'Đơn đăng ký được chấp nhận: {{task}}',
  },
  'notify.APP_APPROVED.body': {
    zh: '{{nickname}}，你报名的任务「{{task}}」已通过审核，请前往平台查看任务详情并开始执行。{{note}}',
    en: 'Hi {{nickname}}, your application for "{{task}}" has been approved. Head to the platform to view task details and get started.{{note}}',
    ja: '{{nickname}}さん、「{{task}}」への応募が承認されました。プラットフォームでタスクの詳細を確認し、開始してください。{{note}}',
    vi: '{{nickname}}, đơn đăng ký của bạn cho "{{task}}" đã được chấp nhận. Vào nền tảng để xem chi tiết nhiệm vụ và bắt đầu.{{note}}',
  },

  'notify.APP_REJECTED.title': {
    zh: '报名未通过：{{task}}',
    en: 'Application not approved: {{task}}',
    ja: '応募未承認：{{task}}',
    vi: 'Đơn đăng ký không được chấp nhận: {{task}}',
  },
  'notify.APP_REJECTED.body': {
    zh: '{{nickname}}，很遗憾，你报名的任务「{{task}}」未通过本次审核。欢迎继续报名其他任务。{{note}}',
    en: 'Hi {{nickname}}, unfortunately your application for "{{task}}" was not approved this time. Feel free to apply for other tasks.',
    ja: '{{nickname}}さん、残念ながら「{{task}}」への応募は今回承認されませんでした。他のタスクへもぜひご応募ください。',
    vi: '{{nickname}}, rất tiếc đơn đăng ký của bạn cho "{{task}}" không được chấp nhận lần này. Hãy tiếp tục đăng ký các nhiệm vụ khác.',
  },

  'notify.DRAFT_APPROVED.title': {
    zh: '草稿审核通过：{{task}}',
    en: 'Draft approved: {{task}}',
    ja: '下書き審査通過：{{task}}',
    vi: 'Bản nháp được duyệt: {{task}}',
  },
  'notify.DRAFT_APPROVED.body': {
    zh: '{{nickname}}，你提交的任务「{{task}}」草稿已通过审核。现在可以正式发布内容，发布后回到任务页提交最终链接。{{note}}',
    en: 'Hi {{nickname}}, your draft for "{{task}}" has been approved. You can now publish your content and submit the final link on the task page.{{note}}',
    ja: '{{nickname}}さん、「{{task}}」の下書きが審査を通過しました。コンテンツを公開し、タスクページから最終リンクを提出してください。{{note}}',
    vi: '{{nickname}}, bản nháp của bạn cho "{{task}}" đã được duyệt. Bạn có thể đăng nội dung và gửi liên kết cuối cùng trên trang nhiệm vụ.{{note}}',
  },

  'notify.DRAFT_REJECTED.title': {
    zh: '草稿审核未通过：{{task}}',
    en: 'Draft not approved: {{task}}',
    ja: '下書き審査未通過：{{task}}',
    vi: 'Bản nháp không được duyệt: {{task}}',
  },
  'notify.DRAFT_REJECTED.body': {
    zh: '{{nickname}}，你提交的任务「{{task}}」草稿未通过审核，请按反馈修改后重新提交草稿。{{note}}',
    en: 'Hi {{nickname}}, your draft for "{{task}}" was not approved. Please revise it based on the feedback and resubmit.{{note}}',
    ja: '{{nickname}}さん、「{{task}}」の下書きが審査を通過しませんでした。フィードバックをもとに修正して再提出してください。{{note}}',
    vi: '{{nickname}}, bản nháp của bạn cho "{{task}}" không được duyệt. Vui lòng sửa theo phản hồi và gửi lại.{{note}}',
  },

  'notify.SUB_APPROVED.title': {
    zh: '内容审核通过：{{task}}',
    en: 'Content approved: {{task}}',
    ja: 'コンテンツ審査通過：{{task}}',
    vi: 'Nội dung được duyệt: {{task}}',
  },
  'notify.SUB_APPROVED.body': {
    zh: '{{nickname}}，你提交的任务「{{task}}」内容已审核通过，报酬将自动结算至你的钱包。{{note}}',
    en: 'Hi {{nickname}}, your submission for "{{task}}" has been approved. Your payout will be automatically settled to your wallet.{{note}}',
    ja: '{{nickname}}さん、「{{task}}」の提出コンテンツが審査を通過しました。報酬は自動的にウォレットへ精算されます。{{note}}',
    vi: '{{nickname}}, nội dung bạn gửi cho "{{task}}" đã được duyệt. Thù lao sẽ tự động được chuyển vào ví của bạn.{{note}}',
  },

  'notify.SUB_REJECTED.title': {
    zh: '内容审核未通过：{{task}}',
    en: 'Content not approved: {{task}}',
    ja: 'コンテンツ審査未通過：{{task}}',
    vi: 'Nội dung không được duyệt: {{task}}',
  },
  'notify.SUB_REJECTED.body': {
    zh: '{{nickname}}，你提交的任务「{{task}}」内容审核未通过，请查看反馈后重新提交。{{note}}',
    en: 'Hi {{nickname}}, your submission for "{{task}}" was not approved. Please review the feedback and resubmit.{{note}}',
    ja: '{{nickname}}さん、「{{task}}」の提出コンテンツが審査を通過しませんでした。フィードバックを確認して再提出してください。{{note}}',
    vi: '{{nickname}}, nội dung bạn gửi cho "{{task}}" không được duyệt. Vui lòng xem phản hồi và gửi lại.{{note}}',
  },

  'notify.RESUBMIT_EXPIRY_WARN.title': {
    zh: '「{{task}}」修改期即将结束',
    en: '"{{task}}" — resubmission window closing soon',
    ja: '「{{task}}」修正期限まであとわずか',
    vi: '"{{task}}" — thời hạn nộp lại sắp kết thúc',
  },
  'notify.RESUBMIT_EXPIRY_WARN.body': {
    zh: '你在「{{task}}」的修改提交还有约 24 小时窗口，逾期名额将自动释放，请抓紧重新提交。',
    en: 'You have approximately 24 hours left to resubmit for "{{task}}". If you miss this window, your spot will be automatically released.',
    ja: '「{{task}}」の修正提出期限まで約 24 時間です。期限を過ぎると参加枠が自動的に解放されます。お早めに再提出してください。',
    vi: 'Bạn còn khoảng 24 giờ để nộp lại cho "{{task}}". Nếu bỏ lỡ, vị trí của bạn sẽ tự động được giải phóng.',
  },

  'notify.SLOT_RELEASED.title': {
    zh: '你在「{{task}}」的参与名额已到期',
    en: 'Your spot in "{{task}}" has expired',
    ja: '「{{task}}」への参加枠が終了しました',
    vi: 'Vị trí của bạn trong "{{task}}" đã hết hạn',
  },
  'notify.SLOT_RELEASED.body': {
    zh: '由于修改期已过，你在「{{task}}」的参与名额已自动结束。如有兴趣可重新报名参与。',
    en: 'The resubmission window for "{{task}}" has passed and your spot has been automatically released. You\'re welcome to apply again.',
    ja: '「{{task}}」の修正期限が過ぎたため、参加枠が自動的に解放されました。再度ご応募いただけます。',
    vi: 'Thời hạn nộp lại cho "{{task}}" đã qua và vị trí của bạn đã được tự động giải phóng. Bạn có thể đăng ký lại.',
  },

  'notify.DRAFT_FINAL_REMINDER.title': {
    zh: '「{{task}}」草稿已通过，记得发布并交终稿',
    en: '"{{task}}" — draft approved, remember to publish & submit',
    ja: '「{{task}}」の下書きが承認されました。投稿と最終提出をお忘れなく',
    vi: '"{{task}}" — bản nháp đã duyệt, nhớ đăng và nộp bài cuối',
  },
  'notify.DRAFT_FINAL_REMINDER.body': {
    zh: '你在「{{task}}」的草稿已通过审核 🎉 去发布内容后回来提交终稿链接，任务就完成、报酬即可到账啦。',
    en: 'Your draft for "{{task}}" has been approved 🎉 Once you publish your content, come back and submit the final link to complete the task and get paid.',
    ja: '「{{task}}」の下書きが承認されました 🎉 コンテンツを投稿後、最終リンクを提出すればタスク完了・報酬が支払われます。',
    vi: 'Bản nháp của bạn cho "{{task}}" đã được duyệt 🎉 Sau khi đăng nội dung, hãy quay lại nộp liên kết cuối để hoàn thành và nhận thù lao.',
  },

  'notify.CONVERSION_UPDATED.title': {
    zh: '推广数据更新：{{task}}',
    en: 'Referral data updated: {{task}}',
    ja: '紹介データ更新：{{task}}',
    vi: 'Dữ liệu giới thiệu đã cập nhật: {{task}}',
  },
  'notify.CONVERSION_UPDATED.body': {
    zh: '你的推广码 {{code}} 数据已更新：注册 {{reg}}、使用 {{used}}。',
    en: 'Your referral code {{code}} data has been updated: {{reg}} registrations, {{used}} uses.',
    ja: '紹介コード {{code}} のデータが更新されました：登録 {{reg}} 件、使用 {{used}} 件。',
    vi: 'Dữ liệu mã giới thiệu {{code}} đã được cập nhật: {{reg}} đăng ký, {{used}} lượt dùng.',
  },

  'notify.CONVERSION_SETTLED.title': {
    zh: '推广收入到账：{{task}}',
    en: 'Referral earnings credited: {{task}}',
    ja: '紹介報酬入金：{{task}}',
    vi: 'Thu nhập giới thiệu đã nhận: {{task}}',
  },
  'notify.CONVERSION_SETTLED.body': {
    zh: '你的推广码 {{code}} 新增 {{conversions}} 次转化，收入 ¥{{amount}} 已入账钱包。',
    en: 'Your referral code {{code}} recorded {{conversions}} new conversions. ¥{{amount}} has been credited to your wallet.',
    ja: '紹介コード {{code}} で新たに {{conversions}} 件のコンバージョンが発生しました。¥{{amount}} がウォレットに入金されました。',
    vi: 'Mã giới thiệu {{code}} có thêm {{conversions}} chuyển đổi. ¥{{amount}} đã được ghi có vào ví của bạn.',
  },

  'notify.TASK_CLOSING.title': {
    zh: '任务关闭缓冲期通知：{{task}}',
    en: 'Task closing — buffer period active: {{task}}',
    ja: 'タスク終了・バッファ期間のお知らせ：{{task}}',
    vi: 'Nhiệm vụ đóng — thời gian đệm đang chạy: {{task}}',
  },
  'notify.TASK_CLOSING.body': {
    zh: '任务「{{task}}」已关闭。数据仍可收录至 {{deadline}}（30 天缓冲期）——请提醒你邀请的用户尽快完成转化，逾期将不再结算。',
    en: '"{{task}}" has been closed. Conversions will still be counted until {{deadline}} (30-day buffer). Please remind your referred users to complete their actions before the deadline.',
    ja: '「{{task}}」が終了しました。{{deadline}} まで（30日間のバッファ）コンバージョンは引き続き計上されます。招待ユーザーに早めの完了を促してください。',
    vi: '"{{task}}" đã đóng. Lượt chuyển đổi vẫn được tính đến {{deadline}} (30 ngày đệm). Hãy nhắc người bạn giới thiệu hoàn thành trước thời hạn.',
  },

  'notify.ARBITRATION_OPENED.title': {
    zh: '平台仲裁已开案：{{task}}',
    en: 'Platform arbitration opened: {{task}}',
    ja: 'プラットフォーム仲裁開始：{{task}}',
    vi: 'Trọng tài nền tảng đã mở: {{task}}',
  },
  'notify.ARBITRATION_OPENED.body': {
    zh: '任务「{{task}}」的交付争议已提交平台仲裁，平台将审阅双方提交与审核记录后裁决，请留意通知。',
    en: 'A delivery dispute for "{{task}}" has been submitted for platform arbitration. The platform will review both parties\' submissions and records before ruling. Please watch for updates.',
    ja: '「{{task}}」の納品に関する紛争がプラットフォーム仲裁に付託されました。双方の提出物と審査記録を確認のうえ裁定します。通知にご注意ください。',
    vi: 'Tranh chấp giao hàng cho "{{task}}" đã được gửi lên trọng tài nền tảng. Nền tảng sẽ xem xét hồ sơ của cả hai bên trước khi phán quyết.',
  },
};

// ─── Brand-facing templates (zh / en / ja / ko) ────────────────────────────

const BRAND: Templates = {
  'notify.TASK_PENDING_REVIEW.title': {
    zh: '任务审核中：{{task}}',
    en: 'Task under review: {{task}}',
    ja: 'タスク審査中：{{task}}',
    ko: '작업 심사 중: {{task}}',
  },
  'notify.TASK_PENDING_REVIEW.body': {
    zh: '你发布的任务「{{task}}」已提交平台审核，预计 1-2 个工作日内完成审核。审核通过后任务将自动上线，届时会再通知你。',
    en: 'Your task "{{task}}" has been submitted for platform review. We\'ll complete the review within 1-2 business days and notify you when it goes live.',
    ja: '「{{task}}」の審査を受け付けました。1〜2営業日以内に審査を完了し、承認後に通知します。',
    ko: '"{{task}}" 작업이 플랫폼 심사에 제출되었습니다. 1-2 영업일 내에 심사를 완료하고 승인 시 알려드리겠습니다.',
  },

  'notify.TASK_APPROVED.title': {
    zh: '任务已上线：{{task}}',
    en: 'Task approved: {{task}}',
    ja: 'タスク承認：{{task}}',
    ko: '작업 승인: {{task}}',
  },
  'notify.TASK_APPROVED.body': {
    zh: '你的任务「{{task}}」已通过平台审核，现在已公开上线，赫使可以开始报名了。',
    en: 'Your task "{{task}}" has been approved and is now live. Ambassadors can start applying.',
    ja: '「{{task}}」が承認され、公開されました。アンバサダーの応募を受け付けています。',
    ko: '"{{task}}" 작업이 승인되어 공개되었습니다. 앰배서더들이 지원을 시작할 수 있습니다.',
  },

  'notify.NEW_APPLICATION.title': {
    zh: '新报名：{{task}}',
    en: 'New application: {{task}}',
    ja: '新規応募：{{task}}',
    ko: '새 지원: {{task}}',
  },
  'notify.NEW_APPLICATION.body': {
    zh: '{{heraldName}} 报名了你的任务「{{task}}」，请前往任务详情审核。',
    en: '{{heraldName}} has applied for your task "{{task}}". Please review the application.',
    ja: '{{heraldName}} さんがタスク「{{task}}」に応募しました。詳細を確認して審査してください。',
    ko: '{{heraldName}}님이 "{{task}}" 작업에 지원했습니다. 지원서를 검토해 주세요.',
  },

  'notify.APP_WITHDRAWN.title': {
    zh: '报名取消：{{task}}',
    en: 'Application withdrawn: {{task}}',
    ja: '応募キャンセル：{{task}}',
    ko: '지원 취소: {{task}}',
  },
  'notify.APP_WITHDRAWN.body': {
    zh: '赫使已取消任务「{{task}}」的报名，名额已释放。是否重新开放招募由你决定。',
    en: 'An ambassador has withdrawn their application for "{{task}}". The slot has been released; reopening recruitment is your call.',
    ja: 'アンバサダーが「{{task}}」への応募をキャンセルしました。枠は解放済みです。募集を再開するかはあなたの判断です。',
    ko: '앰배서더가 "{{task}}" 지원을 취소했습니다. 자리가 반환되었으며, 모집을 다시 열지는 귀하의 결정입니다.',
  },

  'notify.REVIEW_REMINDER.title': {
    zh: '审核提醒：{{task}}',
    en: 'Review reminder: {{task}}',
    ja: '審査リマインダー：{{task}}',
    ko: '검토 알림: {{task}}',
  },
  'notify.REVIEW_REMINDER.body': {
    zh: '任务《{{task}}》有一份{{stage}}提交已等待审核 {{days}} 天，若 24 小时内仍未处理，系统将自动通过{{autoNote}}。',
    en: 'A {{stage}} submission for "{{task}}" has been awaiting review for {{days}} days. If not acted on within 24 hours, it will be automatically approved{{autoNote}}.',
    ja: '「{{task}}」の{{stage}}提出が {{days}} 日間審査待ちです。24 時間以内に対応しない場合、自動承認{{autoNote}}されます。',
    ko: '"{{task}}"의 {{stage}} 제출물이 {{days}}일째 검토 대기 중입니다. 24시간 내에 처리하지 않으면 자동 승인{{autoNote}}됩니다.',
  },

  'notify.SETTLEMENT_BLOCKED.title': {
    zh: '任务待结算 — 请充值完成打款',
    en: 'Task settlement pending — please top up',
    ja: 'タスク精算待ち — 入金して打款を完了してください',
    ko: '작업 정산 대기 중 — 잔액을 충전해 주세요',
  },
  'notify.SETTLEMENT_BLOCKED.body': {
    zh: '任务《{{task}}》已完成，需支付 ¥{{needed}}，当前余额 ¥{{available}} 不足，请充值后系统将自动完成结算。',
    en: '"{{task}}" is complete and requires a payment of ¥{{needed}}, but your current balance of ¥{{available}} is insufficient. Please top up and the settlement will be processed automatically.',
    ja: '「{{task}}」が完了しました。¥{{needed}} の支払いが必要ですが、現在の残高 ¥{{available}} が不足しています。入金後、自動的に精算されます。',
    ko: '"{{task}}" 완료. ¥{{needed}} 지불이 필요하지만 현재 잔액 ¥{{available}}이 부족합니다. 충전 후 자동으로 정산됩니다.',
  },

  'notify.SUBSCRIPTION_ACTIVATED.title': {
    zh: '营销顾问服务已生效',
    en: 'Marketing advisor subscription activated',
    ja: 'マーケティングアドバイザー契約が有効になりました',
    ko: '마케팅 어드바이저 구독이 활성화되었습니다',
  },
  'notify.SUBSCRIPTION_ACTIVATED.body': {
    zh: '你的营销顾问订阅（{{plan}}）已生效，本期至 {{period}}，已从余额扣除 ¥{{amount}}（{{invoice}}）。',
    en: 'Your marketing advisor subscription ({{plan}}) is now active until {{period}}. ¥{{amount}} has been deducted from your balance ({{invoice}}).',
    ja: 'マーケティングアドバイザー（{{plan}}）が有効になりました。有効期限は {{period}} まで。¥{{amount}} が残高から引き落とされました（{{invoice}}）。',
    ko: '마케팅 어드바이저({{plan}}) 구독이 {{period}}까지 활성화되었습니다. 잔액에서 ¥{{amount}}가 차감되었습니다({{invoice}}).',
  },

  'notify.SUBSCRIPTION_RENEWED.title': {
    zh: '订阅已自动续期',
    en: 'Subscription automatically renewed',
    ja: 'サブスクリプションが自動更新されました',
    ko: '구독이 자동 갱신되었습니다',
  },
  'notify.SUBSCRIPTION_RENEWED.body': {
    zh: '你的营销顾问订阅（{{plan}}）已续期，本期至 {{period}}，已从余额扣除 ¥{{amount}}（{{invoice}}）。',
    en: 'Your marketing advisor subscription ({{plan}}) has been renewed until {{period}}. ¥{{amount}} has been deducted from your balance ({{invoice}}).',
    ja: 'マーケティングアドバイザー（{{plan}}）が更新されました。有効期限は {{period}} まで。¥{{amount}} が残高から引き落とされました（{{invoice}}）。',
    ko: '마케팅 어드바이저({{plan}}) 구독이 {{period}}까지 갱신되었습니다. 잔액에서 ¥{{amount}}가 차감되었습니다({{invoice}}).',
  },

  'notify.SUBSCRIPTION_EXPIRED.title': {
    zh: '营销顾问订阅已到期',
    en: 'Marketing advisor subscription expired',
    ja: 'マーケティングアドバイザーの契約が終了しました',
    ko: '마케팅 어드바이저 구독이 만료되었습니다',
  },
  'notify.SUBSCRIPTION_EXPIRED.body': {
    zh: '你的订阅已到期，发布数量回落至阶梯默认；进行中的任务不受影响。可随时重新订阅恢复权益。',
    en: 'Your subscription has expired. Task publishing limits have reverted to the default tier; active tasks are unaffected. You can resubscribe at any time.',
    ja: 'サブスクリプションが終了しました。タスク発行数はデフォルト階層に戻りましたが、進行中のタスクには影響しません。いつでも再契約できます。',
    ko: '구독이 만료되었습니다. 게시 한도가 기본 등급으로 돌아갔습니다. 진행 중인 작업에는 영향 없음. 언제든지 재구독 가능합니다.',
  },

  'notify.SUBSCRIPTION_RENEWAL_DUE.title': {
    zh: '订阅将于 {{period}} 自动续期',
    en: 'Subscription renewing on {{period}}',
    ja: 'サブスクリプションが {{period}} に自動更新されます',
    ko: '구독이 {{period}}에 자동 갱신됩니다',
  },
  'notify.SUBSCRIPTION_RENEWAL_DUE.body': {
    zh: '你的营销顾问订阅将自动续期，应付 ¥{{amount}}。请确保账户余额充足；余额不足将进入 {{graceDays}} 天宽限期。如需取消可在订阅页操作。',
    en: 'Your marketing advisor subscription will automatically renew for ¥{{amount}}. Please ensure sufficient balance; insufficient funds will trigger a {{graceDays}}-day grace period. You can cancel anytime on the subscription page.',
    ja: 'マーケティングアドバイザーが ¥{{amount}} で自動更新されます。残高を十分にご確保ください。不足の場合は {{graceDays}} 日の猶予期間に入ります。サブスクリプションページからいつでもキャンセルできます。',
    ko: '마케팅 어드바이저 구독이 ¥{{amount}}로 자동 갱신됩니다. 잔액이 부족하면 {{graceDays}}일 유예 기간이 시작됩니다. 구독 페이지에서 취소할 수 있습니다.',
  },

  'notify.SUBSCRIPTION_PAST_DUE.title': {
    zh: '订阅续期扣款失败 — 请充值',
    en: 'Subscription renewal failed — please top up',
    ja: 'サブスクリプション更新の引き落とし失敗 — 入金してください',
    ko: '구독 갱신 실패 — 잔액을 충전해 주세요',
  },
  'notify.SUBSCRIPTION_PAST_DUE.body': {
    zh: '续期需 ¥{{needed}}，当前余额不足。{{graceDays}} 天宽限期内充值到账即自动续期，逾期订阅将到期回落。',
    en: 'Renewal requires ¥{{needed}} but your balance is insufficient. Top up within {{graceDays}} days to auto-renew; otherwise the subscription will expire.',
    ja: '更新には ¥{{needed}} 必要ですが残高が不足しています。{{graceDays}} 日以内に入金すると自動更新されます。期限を過ぎるとサブスクリプションは終了します。',
    ko: '갱신에 ¥{{needed}}가 필요하지만 잔액이 부족합니다. {{graceDays}}일 이내 충전하면 자동 갱신됩니다. 그렇지 않으면 구독이 만료됩니다.',
  },
};

// ─── Seed ──────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date().toISOString();
  let inserted = 0, skipped = 0;
  const all: Templates = { ...HERALD, ...BRAND };

  for (const [key, locales] of Object.entries(all)) {
    for (const [locale, value] of Object.entries(locales) as [Locales, string][]) {
      const res = await pool.query(
        `INSERT INTO i18n_entries (key, locale, value, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, 'seed')
         ON CONFLICT (key, locale) DO UPDATE
           SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = 'seed'
           WHERE i18n_entries.updated_by = 'seed'`,
        [key, locale, value, now]
      );
      if (res.rowCount && res.rowCount > 0) inserted++;
      else skipped++;
    }
  }

  console.log(`✅ notify templates: ${inserted} upserted, ${skipped} skipped (human-edited)`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
