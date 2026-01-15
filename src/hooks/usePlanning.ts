import { useState, useRef } from 'react'
import { generatePlan, type PlanTask, type PlanResult } from '../services/plan'
import type { ViewTimeframe } from '@/types/todo'

// イントロ用サンプル計画データ（3年でGoogle新卒内定を目指す例）
export const INTRO_SAMPLE_PLAN: PlanResult = {
  currentState: "2026/1/12時点で、1日2〜4時間の継続学習時間を確保できる。Google新卒内定を3年後に目指しており、選考情報（体験談・落選談・難易度）を一部把握している。",
  goalState: "2029/1/12までにGoogle（想定：Google JapanのSWE/新卒枠）から新卒内定を獲得する。書類（CV/ES）→オンラインコーディングテスト→面接（技術面接複数回＋行動面接）を突破できる実力と実績を揃える。",
  gap: "①コーディングテスト/技術面接で安定して解けるアルゴリズム・データ構造の演習量と復習サイクル（目安：LeetCode/AtCoder合計300〜500問＋復習）②CS基礎（OS/ネットワーク/DB/計算量）③実務・開発実績（インターン、プロジェクト、OSS等）④行動面接（STARで語れるエピソード15〜20個）⑤応募書類（英語CV含む）と応募戦略（インターン経由/リファラル等）の整備。",
  feasibility: {
    verdict: "CHALLENGING",
    availableHours: 1638,
    requiredHours: 1900,
    calculation: "期限=3年後(2029/1/12)まで。平日稼働のみ・週末休み前提。稼働日=約3年×52週×5日=780日。1日平均3時間（2〜4hの中央値）×稼働率0.7（割り込み/体調/試験等）=2.1h/日。利用可能総時間=780×2.1=1638h。必要時間は、体験談ベースの演習量（LeetCode150+AtCoder100+AlgoExpert100=約350問）を'初見は2〜3倍かかる'前提で、(①アルゴ/DS演習・復習 900h) + (②CS基礎 250h) + (③開発実績/ポートフォリオ 350h) + (④面接対策(模擬/STAR) 150h) + (⑤応募準備/ネットワーキング 100h) + バッファ30%（約450h）≒合計1900hと見積もり。",
    adjustment: "達成確度を上げるには、(A)平日平均を3.5〜4hに寄せる、または(B)月1回だけ週末に半日(4h)確保、または(C)目標を『Google級（BigTech/外資SaaS含む）複数社内定→Google最優先』に広げて確率を上げる。最短で現実的なのは(A)+(C)。"
  },
  risks: [
    "スケジュールリスク: 学業/研究/アルバイト/サークル等で平日2〜4hが崩れ、復習が回らず演習が'解きっぱなし'になる。",
    "技術的リスク: アルゴリズムは解けても、面接での説明（思考の言語化）・バグ修正・計算量説明が弱く評価が伸びない。",
    "外部リスク: 新卒募集枠・採用人数・選考プロセスが年度で変動し、準備していた型が一部通用しない。",
    "競争リスク: 採用倍率が極めて高い（約0.2%という言及あり）ため、実力が十分でも運・タイミング・枠の影響で落ちる可能性が高い。",
    "精神コストリスク: 長期戦で不合格/停滞が続くと学習が止まる。短期の'詰め込み'に偏ると燃え尽きやすい。"
  ],
  costs: [
    "時間コスト: 3年間で平日780日×2〜4hの継続。演習（解く）だけでなく復習・記録・模擬面接に時間が必要。",
    "金銭コスト: LeetCode Premium数ヶ月課金の可能性、AlgoExpert/SystemsExpert、模擬面接（Exponent等の有料枠）、書籍（EPI/CCI等）で合計数万円〜十数万円規模になり得る。",
    "精神コスト: 毎日学習＋定期的な模擬面接の緊張、落選時のダメージ、周囲比較によるストレス。",
    "機会コスト: インターン/開発に時間を割くため、他活動（バイト/趣味/単位の余裕）を削る必要が出る。"
  ],
  summary: "3年を「基礎固め→実績作り→選考特化」の3フェーズに分け、アルゴ/DSをLeetCode・AtCoder中心に300〜500問規模で'復習込み'で回しつつ、インターン/プロジェクトでCVに書ける成果を作る。最後の6〜9ヶ月は、技術面接（45分×複数回）と行動面接（STAR 15〜20本）を模擬面接で仕上げ、応募・リファラル・インターン経由を含む複線で内定確率を最大化する。",
  estimatedDays: 780,
  tasks: [
    {
      title: "目標をSWE新卒に具体化し合格条件を定義する",
      description: "Googleの目標職種を『Google Japan SWE新卒（第一志望）』として明文化し、合格条件を数値化する（例：LeetCode合計300問/うちMedium200、AtCoder100、STARエピソード20本、模擬面接10回、CV1ページ完成）。",
      priority: "high",
      daysFromStart: 0,
      estimatedMinutes: 90
    },
    {
      title: "選考プロセスを体験談から逆算してチェックリスト化する",
      description: "体験談/記事から、選考ステップ・必要演習量・失敗点を抜き出してチェックリスト化する。",
      priority: "high",
      daysFromStart: 1,
      estimatedMinutes: 120
    },
    {
      title: "LeetCodeとAtCoderの学習環境を整備する",
      description: "LeetCodeとAtCoderにアカウント作成/整備し、使用言語を1つに固定。提出コードをGitHubに連携し、進捗記録用スプレッドシートを作る。",
      priority: "high",
      daysFromStart: 2,
      estimatedMinutes: 120
    },
    {
      title: "アルゴリズム学習の最初の2週間スプリントを作成する",
      description: "2週間で『配列/文字列・ハッシュ・二分探索・スタック/キュー』を回す計画を作る（平日10日×各日2問=20問＋復習2日）。",
      priority: "high",
      daysFromStart: 3,
      estimatedMinutes: 90
    },
    {
      title: "LeetCodeを2問解き、復習テンプレを確立する",
      description: "LeetCodeでEasy〜Mediumを2問解き、解法を『問題要約→方針→計算量→落とし穴→別解』で200〜400字にまとめる。",
      priority: "high",
      daysFromStart: 4,
      estimatedMinutes: 120
    }
  ],
  resources: [
    {
      name: "外資就活ドットコム（Google体験談）",
      type: "website",
      description: "Googleインターン経由の内定・英語が得意でなくても挑戦した事例。",
      cost: "無料（会員限定部分あり）"
    },
    {
      name: "LeetCode",
      type: "service",
      description: "アルゴリズム/データ構造の面接対策。タグ問題・頻出問題の演習に使う。",
      cost: "無料 / 有料（Premium）"
    },
    {
      name: "AtCoder",
      type: "service",
      description: "競技プログラミングで実装力と速度を鍛える。過去問演習に使う。",
      cost: "無料"
    },
    {
      name: "Pramp（模擬面接）",
      type: "service",
      description: "ペアで模擬面接を回し、説明力・緊張耐性を鍛える。",
      cost: "無料（枠制限あり）"
    }
  ],
  tips: [
    "演習は『解く→復習→数週間後に解き直す』までが1セット。復習日を最初からカレンダーに固定する。",
    "技術面接は'正解'だけでなく、思考の言語化・計算量・境界条件・バグ修正が評価対象。毎回、声に出して説明する練習を入れる。",
    "インターン経由が強いルートになり得る。3年計画なら、毎年『夏インターン応募』を必達イベントにする。",
    "STARエピソードは早めに作り、経験が増えるたびに差し替える。最終的に15〜20本を用意する。",
    "倍率が極端に高い前提で、Google一本足打法にしない。同時に複数社へ応募して確率を上げる。"
  ]
}

export function usePlanning() {
  // プラン関連の状態
  const [planGoal, setPlanGoal] = useState('')
  const [planTargetDays, setPlanTargetDays] = useState<number>(30) // デフォルト: 1ヶ月
  const [planTargetPreset, setPlanTargetPreset] = useState<string>('30') // プリセット選択値
  const [planCustomDate, setPlanCustomDate] = useState<string>('') // カスタム日付
  const [planResult, setPlanResult] = useState<PlanResult | null>(null)
  const [planTasks, setPlanTasks] = useState<PlanTask[]>([])
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
  const [planError, setPlanError] = useState('')
  const [editingPlanTaskIndex, setEditingPlanTaskIndex] = useState<number | null>(null)
  const [editingPlanTaskTitle, setEditingPlanTaskTitle] = useState('')
  const [planLabel, setPlanLabel] = useState('')
  const [planProjectId, setPlanProjectId] = useState<string | null>(null)
  const [showNewProjectInPlan, setShowNewProjectInPlan] = useState(false)
  const [newProjectNameInPlan, setNewProjectNameInPlan] = useState('')

  // イントロ関連のref
  const introSamplePlanRef = useRef<PlanResult | null>(null)
  const introPrevTimeframeRef = useRef<ViewTimeframe>('today')

  return {
    // プラン関連の状態
    planGoal,
    setPlanGoal,
    planTargetDays,
    setPlanTargetDays,
    planTargetPreset,
    setPlanTargetPreset,
    planCustomDate,
    setPlanCustomDate,
    planResult,
    setPlanResult,
    planTasks,
    setPlanTasks,
    isGeneratingPlan,
    setIsGeneratingPlan,
    planError,
    setPlanError,
    editingPlanTaskIndex,
    setEditingPlanTaskIndex,
    editingPlanTaskTitle,
    setEditingPlanTaskTitle,
    planLabel,
    setPlanLabel,
    planProjectId,
    setPlanProjectId,
    showNewProjectInPlan,
    setShowNewProjectInPlan,
    newProjectNameInPlan,
    setNewProjectNameInPlan,

    // イントロ関連のref
    introSamplePlanRef,
    introPrevTimeframeRef,

    // サービス関数（再エクスポート）
    generatePlan,
  }
}

// 型の再エクスポート
export type { PlanTask, PlanResult }
