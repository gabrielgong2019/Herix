/**
 * Demo 任务数据 — 仅用于展示/演示环境
 * 用法: npx tsx scripts/seed-demo-tasks.ts
 *
 * 幂等：以 title 为去重键，已存在则跳过。
 */
import { pool } from '../src/db';
import crypto from 'crypto';

// 用法: npx tsx scripts/seed-demo-tasks.ts <brand-email>
const brandEmail = process.argv[2];
if (!brandEmail) {
  console.error('Usage: npx tsx scripts/seed-demo-tasks.ts <brand-email>');
  process.exit(1);
}

const uid = () => crypto.randomBytes(16).toString('hex');
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

interface DemoTask {
  title: string;
  description: string;
  category: string;
  content_type: 'photo' | 'video' | 'referral';
  mode: 'STANDARD' | 'PERFORMANCE';
  budget: number;
  commission: number;
  max_heralds: number;
  difficulty: 'easy' | 'medium' | 'hard';
  platform_requirements: object[];
  // content spec extras
  min_images?: number;
  min_video_seconds?: number;
  require_draft_review?: boolean;
}

const DEMOS: DemoTask[] = [
  {
    title: '【美食】东京拉面店 SNS 拡散キャンペーン',
    description:
      '新宿にオープンした本格博多豚骨ラーメン店のPRをお願いします。\n\n' +
      '【投稿内容】\n- ラーメン・餃子・チャーシューの写真を3枚以上\n- 来店した感想（日本語または中国語）\n- ハッシュタグ #新宿ラーメン #博多豚骨 必須\n\n' +
      '【対象SNS】Instagram・TikTok・小紅書のいずれか\n\n' +
      '初回投稿後、弊社スタッフが内容を確認してから承認します。',
    category: 'food',
    content_type: 'photo',
    mode: 'STANDARD',
    budget: 150000,
    commission: 8000,
    max_heralds: 10,
    difficulty: 'easy',
    platform_requirements: [
      { platformId: 'instagram', minFollowers: 1000 },
      { platformId: 'tiktok', minFollowers: 500 },
      { platformId: 'xiaohongshu', minFollowers: 500 },
    ],
    min_images: 3,
    require_draft_review: true,
  },
  {
    title: '【美妆】新款气垫BB霜 开箱测评视频',
    description:
      '韩国热门彩妆品牌新品气垫BB霜，诚邀海外华人美妆达人合作！\n\n' +
      '【内容要求】\n- 视频时长 60 秒以上\n- 包含开箱、上脸试色、对比妆前妆后\n- 发布平台：TikTok / 抖音 / 小红书\n\n' +
      '【提供】产品小样一份（快递到府），合作完成后追加奖励 ¥3,000\n\n' +
      '有美妆测评经验优先，欢迎新人尝试！',
    category: 'beauty',
    content_type: 'video',
    mode: 'STANDARD',
    budget: 200000,
    commission: 12000,
    max_heralds: 8,
    difficulty: 'medium',
    platform_requirements: [
      { platformId: 'tiktok', minFollowers: 2000 },
      { platformId: 'xiaohongshu', minFollowers: 1000 },
    ],
    min_video_seconds: 60,
    require_draft_review: false,
  },
  {
    title: '【Fashion】海外ファッションブランド 春夏新作 着用レポ',
    description:
      '在日外国人向けのファッションブランドが春夏コレクションを発売！\n\n' +
      '【お願いしたいこと】\n- 商品を着用した写真を4枚以上（コーデ全体・ディテール含む）\n- キャプション：着心地・サイズ感のリアルな感想\n- Instagram または 小紅書 への投稿\n\n' +
      '商品はプレゼント、投稿完了後に報酬をお支払いします。\n日本語・中国語・英語いずれでもOK！',
    category: 'fashion',
    content_type: 'photo',
    mode: 'STANDARD',
    budget: 300000,
    commission: 15000,
    max_heralds: 15,
    difficulty: 'medium',
    platform_requirements: [
      { platformId: 'instagram', minFollowers: 3000 },
      { platformId: 'xiaohongshu', minFollowers: 2000 },
    ],
    min_images: 4,
    require_draft_review: true,
  },
  {
    title: '【旅行】沖縄リゾートホテル 宿泊体験レポ（モニタープラン）',
    description:
      '沖縄の高級リゾートホテルのモニター宿泊プランです！\n\n' +
      '【提供内容】\n- 1泊2日無料宿泊（朝食付き）\n- プール・スパ利用無料\n\n' +
      '【投稿条件】\n- 宿泊中・宿泊後に Instagram Reels または TikTok 動画（30秒以上）を1本\n- 写真投稿（フィード）を2枚以上\n- ハッシュタグ指定あり\n\n' +
      '海外ルーツのフォロワーが多い方、旅行・グルメ系の発信をしている方を優先いたします。',
    category: 'travel',
    content_type: 'video',
    mode: 'STANDARD',
    budget: 500000,
    commission: 30000,
    max_heralds: 3,
    difficulty: 'hard',
    platform_requirements: [
      { platformId: 'instagram', minFollowers: 5000 },
      { platformId: 'tiktok', minFollowers: 5000 },
    ],
    min_video_seconds: 30,
    min_images: 2,
    require_draft_review: true,
  },
  {
    title: '【金融】海外送金アプリ 新規登録キャンペーン（成果報酬型）',
    description:
      '在日外国人向けの海外送金サービスの新規ユーザー獲得キャンペーンです。\n\n' +
      '【報酬】紹介コード経由で新規登録 + 初回送金完了 1件につき ¥2,500\n\n' +
      '【発信内容のヒント】\n- 海外送金の便利さ・手数料の安さについての体験談\n- アプリの使い方紹介\n- 家族への仕送りエピソード\n\n' +
      '上限なし、成果が上がれば上がるほど収入UP！SNS・口コミ・LINE 何でも可。',
    category: 'finance',
    content_type: 'referral',
    mode: 'PERFORMANCE',
    budget: 1000000,
    commission: 2500,
    max_heralds: 50,
    difficulty: 'easy',
    platform_requirements: [],
  },
];

async function main() {
  await pool.query('SELECT 1'); // warm up

  let created = 0;
  let skipped = 0;

  for (const demo of DEMOS) {
    const existing = await pool.query(
      'SELECT id FROM tasks WHERE title = $1 AND creator_id = $2',
      [demo.title, BRAND_USER_ID],
    );
    if (existing.rows.length > 0) {
      console.log(`⏭  skip: ${demo.title}`);
      skipped++;
      continue;
    }

    const taskId = uid();
    const ts = now();

    await pool.query(
      `INSERT INTO tasks
         (id, creator_id, mode, title, description, budget, commission, currency,
          max_heralds, difficulty, category, content_type, status, published_at,
          escrow_amount, is_escrowed, code_mode, platform_requirements, created_at, updated_at)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,'JPY',$8,$9,$10,$11,'OPEN',$12,$6,0,'auto',$13,$14,$14)`,
      [
        taskId,
        BRAND_USER_ID,
        demo.mode,
        demo.title,
        demo.description,
        demo.budget,
        demo.commission,
        demo.max_heralds,
        demo.difficulty,
        demo.category,
        demo.content_type,
        ts,
        JSON.stringify(demo.platform_requirements),
        ts,
      ],
    );

    if (demo.content_type !== 'referral') {
      await pool.query(
        `INSERT INTO task_content_specs
           (task_id, content_type, min_images, min_video_seconds, max_revisions, require_draft_review, require_proposal)
         VALUES ($1,$2,$3,$4,2,$5,false)`,
        [
          taskId,
          demo.content_type === 'video' ? 'video' : 'photo',
          demo.min_images ?? null,
          demo.min_video_seconds ?? null,
          demo.require_draft_review ?? false,
        ],
      );
    } else {
      await pool.query(
        `INSERT INTO task_referral_specs (task_id, code_mode, data_mode)
         VALUES ($1,'auto','AGGREGATE')`,
        [taskId],
      );
    }

    console.log(`✅ created: ${demo.title}`);
    created++;
  }

  console.log(`\nDEMO SEED DONE — created ${created}, skipped ${skipped}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
