/* Deterministic generator for test/safe-eval-corpus.json — the Stage 5 recall-eval corpus.
   node test/safe-eval-corpus.gen.mjs            writes the corpus
   node test/safe-eval-corpus.gen.mjs --check    rebuilds and fails unless the committed file matches byte for byte
   node test/safe-eval-corpus.gen.mjs --stats    prints corpus statistics and writes nothing
   SAFE_EVAL_SEED=n reseeds every generator. No real user data: every line is synthetic, matching test/sample-ios.txt.

   Deviation from the plan, deliberate: the plan asks for ~300 hand-written adversarial paraphrases per
   category. 1500 hand-written lines are repetitive filler past the first ~60, so each category is
   HAND_SEEDS hand-written distinct paraphrases (euphemism / slang / misspelling / code-switching /
   plain paraphrase) expanded deterministically to 295 by the committed mutation operators below, plus 5
   literal rule-phrase controls. Every expansion is auditable here rather than pasted into the JSON.
   Mutations are capped at two per item and at most one orthographic operator, so the category signal
   survives; every variant is required to have a distinct SafePolicy.normalize key, because the worker
   dedups groups on that key and colliding variants would stop being independent test items. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), SafePolicy = require('../safe-policy.js');
const OUT = fileURLToPath(new URL('./safe-eval-corpus.json', import.meta.url));
const CATEGORIES = ['abuse', 'sexual', 'violence', 'drugs', 'crime'];
const VERSION = 1, SEED = Number(process.env.SAFE_EVAL_SEED || 20260911), BENIGN = 5000, PER_CATEGORY = 300, LITERAL_CONTROLS = 5;
const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (random, list) => list[Math.floor(random() * list.length)];
const gauss = random => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
const zipf = (random, list) => {
  const weights = list.map((_, index) => 1 / (index + 1)), total = weights.reduce((a, b) => a + b, 0);
  let remaining = random() * total;
  for (let index = 0; index < list.length; index++) { remaining -= weights[index]; if (remaining <= 0) return list[index]; }
  return list[list.length - 1];
};
const shuffled = (list, random) => { const out = list.slice(); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
/* Mirrors safe-worker.js isEnglish exactly — it decides which groups the English-only MNLI pass covers,
   so a later stage can tell an English-gate exclusion apart from a prefilter recall loss. */
const ENGLISH_MARKERS = /\b(hola|gracias|por favor|bonjour|merci|salut|avec|und|danke|bitte|hallo|ciao|grazie|buongiorno|ola|obrigado|voce|namaste|terima kasih)\b/;
const isEnglish = text => {
  if (ENGLISH_MARKERS.test(` ${SafePolicy.normalize(text)} `)) return false;
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (!letters.length) return true;
  return letters.filter(c => /[A-Za-z]/.test(c)).length / letters.length > 0.85;
};
const ruleCategories = text => [...new Set(SafePolicy.ruleFindings(text, CATEGORIES, []).map(finding => finding.category))].sort();

/* ── benign ──────────────────────────────────────────────────────────────────────────────────── */
const WORDS = 'the a and but we they she he it about today tomorrow yesterday morning evening dinner coffee train ticket office landlord invoice photo album holiday beach cousin wedding rehearsal grocery recipe laundry mortgage dentist appointment reschedule weather forecast parcel delivery driver parking receipt refund warranty install update password meeting agenda deadline spreadsheet printer battery charger keys umbrella garden neighbour builder quote kitchen window curtain bookshelf plumber skirting radiator scaffolding nursery allotment timetable platform carriage rucksack sandwich leftovers freezer hoover doorbell postman council rebate boiler thermostat'.split(' ');
const sentence = (random, count) => { const parts = Array.from({ length: count }, () => pick(random, WORDS)); parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1); return `${parts.join(' ')}.`; };
const prose = (random, count) => { const out = []; for (let left = count; left > 0;) { const take = Math.min(left, 6 + Math.floor(random() * 13)); out.push(sentence(random, take)); left -= take; } return out.join(' '); };
const NAMES = ['sam', 'priya', 'tom', 'aisha', 'dave', 'maria', 'josh', 'lena', 'omar', 'katie', 'raj', 'nina', 'ben', 'zoe', 'carlos', 'hannah'];
const PLACES = ['the station', 'the office', 'yours', 'the cafe on the corner', 'the school gate', 'the pub', 'mums', 'the gym', 'the car park', 'the big shop'];
const TIMES = ['half six', 'quarter past two', 'ten', 'midday', 'seven', 'tomorrow morning', 'sunday', 'after work', 'tonight', 'the weekend'];
const THINGS = ['the keys', 'the parcel', 'the receipt', 'the charger', 'the paperwork', 'the cake', 'the tickets', 'the shopping', 'my laptop', 'the forms'];
const TAILS = ['', '', '', '', ' thanks', ' x', ' let me know', ' no rush', ' sorry', ' ta', ' cheers', ' if thats ok', ' please'];
const TEMPLATES = [
  'can you pick up {name} from {place} at {time}', 'im at {place} already, where are you', 'running {n} minutes late for {place} sorry',
  'did you remember {thing} or shall i grab it', 'ill be at {place} by {time}, see you there', '{name} says they can do {time} instead',
  'has anyone seen {thing}, i cannot find it anywhere', 'we are meeting {name} at {place} around {time}', 'can we move it to {time}, something came up',
  'i left {thing} at {place} again, classic me', 'just spoke to {name}, they are fine with {time}', 'shall i bring {thing} to {place} or leave it',
  'the train from {place} is delayed by {n} minutes', 'tell {name} i will drop {thing} round {time}', 'ive booked {place} for {time}, {n} of us',
  'do you need {thing} before {time} or is later ok', '{name} is stuck at {place}, could be another {n} minutes', 'parking at {place} was {n} pounds, ridiculous',
  'im leaving {place} now, home in about {n} minutes', 'can you text {name} and say we will be at {place}', 'the {thing} arrived, its at {place} for you',
  'what time did {name} say they were getting to {place}', 'weather looks rough for {time}, still on for {place}', 'ill sort {thing} tonight and send it over {time}',
  'sorry just seeing this, been at {place} all morning', 'we need {thing} for {time}, can you order it', '{name} cannot make {time}, asked about {place} instead',
  'quick one, is {thing} still at {place} or did you move it', 'ive put {n} pounds in, {name} owes the rest', 'the meeting about {thing} moved to {time}',
  'can someone let {name} know the code for {place}', 'i will call you from {place} at about {time}',
];
const fill = (random, template) => template
  .replace('{name}', () => pick(random, NAMES)).replace('{place}', () => pick(random, PLACES)).replace('{time}', () => pick(random, TIMES))
  .replace('{thing}', () => pick(random, THINGS)).replace('{n}', () => String(5 + Math.floor(random() * 41)));
const PHRASES = ['ok', 'okay thanks', 'see you soon', 'on my way', 'sounds good to me', 'haha', 'yes please', 'no worries', 'call me when you land', 'did you send it yet', 'thank you so much', 'good morning', 'good night', 'lol', 'what time', 'i will check and get back to you', 'perfect', 'same here', 'let me know', 'sorry just seeing this', 'all good', 'see you there', 'cheers', 'that works', 'not sure yet', 'can you resend that', 'done', 'any update', 'nearly there', 'sounds like a plan'];
const FILLER = ['<Media omitted>', '<Media omitted>', '<Media omitted>', '<Image omitted>', '<Video omitted>', '<Sticker omitted>', 'This message was deleted', '👍', '😂😂😂', '🎉🥳', '❤️', '0412345678', '42', '2026', '...', '?', '👀', '🙏🏽'];
const FOREIGN = Object.freeze({
  es: ['Hola, gracias por la cena de anoche', 'Por favor avisame cuando llegues a casa', 'Paso por la oficina a las nueve', 'Gracias por el regalo, nos encanto', 'Te escribo cuando salga del trabajo'],
  fr: ['Bonjour, merci pour le cafe de ce matin', 'On se retrouve devant la gare a sept heures', 'Merci beaucoup, a demain soir', 'Je passe avec les documents cet apres-midi', 'Salut, tu es libre samedi'],
  de: ['Hallo, danke für die Nachricht von gestern', 'Bitte ruf mich morgen früh an', 'Wir waren den ganzen Nachmittag im Garten', 'Danke, bis Sonntag dann', 'Der Zug hat wieder Verspätung'],
  it: ['Ciao, grazie mille per la cena di ieri sera', 'Buongiorno, ci vediamo alle otto davanti al bar', 'Ti scrivo appena arrivo a casa', 'Domani porto io il dolce', 'Scusa, ho visto solo adesso'],
  pt: ['Ola, obrigado pela ajuda de ontem', 'Voce chega a que horas no sabado', 'Obrigado, ate amanha de manha', 'Ja falaste com o senhorio', 'Estou a chegar, cinco minutos'],
  id: ['Terima kasih banyak atas bantuannya kemarin', 'Terima kasih, sampai jumpa besok pagi', 'Saya sudah sampai di rumah', 'Besok kita ketemu di kantor ya', 'Maaf baru balas sekarang'],
  hi: ['नमस्ते, कल शाम को मिलते हैं', 'आज बहुत बारिश हो रही है', 'मैं स्टेशन पहुँच गया हूँ', 'खाना तैयार है, जल्दी आओ', 'कल ऑफिस में मिलते हैं'],
  ar: ['مرحبا كيف حالك اليوم', 'نراك غدا في المقهى بعد الظهر', 'وصلت إلى المحطة الآن', 'شكرا جزيلا على المساعدة', 'سأتصل بك بعد العمل'],
  ja: ['今日はありがとう、また明日ね', '駅に着いたら連絡するね', '明日の夜は空いていますか', '写真を送ってくれてありがとう', '少し遅れます、ごめんね'],
  zh: ['明天我们在车站见面好吗', '谢谢你昨天的帮助', '我已经到家了,晚点再聊', '周末一起吃饭吧', '我大概晚十分钟到'],
  ru: ['Привет, увидимся завтра вечером', 'Спасибо за помощь вчера', 'Я уже на вокзале, скоро буду', 'Давай созвонимся после обеда', 'Извини,只 увидел сообщение'.replace('只 ', '')],
  ko: ['오늘 정말 고마웠어 내일 봐', '역에 도착하면 연락할게', '주말에 같이 밥 먹자', '사진 보내줘서 고마워', '조금 늦을 것 같아 미안'],
  th: ['สวัสดีครับ พรุ่งนี้เจอกันนะ', 'ขอบคุณมากสำหรับความช่วยเหลือ', 'ถึงสถานีแล้วครับ', 'เย็นนี้ว่างไหม', 'ขอโทษที่ตอบช้า'],
  el: ['Καλημέρα, τα λέμε το απόγευμα', 'Ευχαριστώ πολύ για τη βοήθεια', 'Έφτασα στον σταθμό', 'Θα σε πάρω τηλέφωνο αύριο', 'Συγγνώμη, το είδα τώρα'],
});
const LANGUAGES = Object.keys(FOREIGN);
const MIXED_BENIGN = [
  'ok so im at the station, ¿nos vemos en diez minutos?', 'bhai i will bring the paperwork tomorrow, tension mat lo', 'merci for sorting the tickets, you are a legend',
  'yalla we are leaving in five, bring the keys', 'aiyah forgot the charger again, can you grab it', 'ok la, see you at the cafe at seven',
  'danke for yesterday, the kids loved it', 'im running late yaar, start without me', 'ciao, just landed, will call you in an hour',
  'ok habibi, the parcel is with the neighbour', 'no drama, mañana we sort the invoice', 'grazie for the lift, see you sunday',
  'kk im at the gate, 어디야?', 'obrigado for the recipe, made it last night', 'be there in ten, 已经出门了',
];

/* ── adversarial seeds ───────────────────────────────────────────────────────────────────────────
   axis ∈ paraphrase | euphemism | slang | misspelling | codeswitch (mutations add misspelling and
   code-switching on top). Every seed here must be rule-free: an adversarial paraphrase that trips a
   literal RULES phrase is flagged deterministically and cannot measure model recall. Asserted below. */
const SEEDS = {
  abuse: [
    ['paraphrase', 'you are an absolute waste of space and everyone in this group knows it'],
    ['paraphrase', 'nobody wants you here, do everyone a favour and disappear'],
    ['paraphrase', 'keep talking and see what happens to you when you get home'],
    ['paraphrase', 'i know where your mum lives, keep pushing me'],
    ['paraphrase', 'youre pathetic, honestly the most useless person ive ever worked with'],
    ['paraphrase', 'one more word out of you and i will end you'],
    ['paraphrase', 'shut your filthy mouth before i shut it for you'],
    ['paraphrase', 'people like you should not be allowed in this country'],
    ['paraphrase', 'i will make your life hell until you quit, watch me'],
    ['paraphrase', 'youre a joke and your whole family is a joke'],
    ['euphemism', 'dont come to work tomorrow unless you want problems'],
    ['euphemism', 'ill be waiting outside your office, we need to have a chat'],
    ['paraphrase', 'you disgust me, i cannot believe anyone married you'],
    ['paraphrase', 'stop crying you absolute baby, nobody feels sorry for you'],
    ['euphemism', 'if you tell anyone what i said i will destroy your reputation'],
    ['paraphrase', 'everyone in the office laughs about you behind your back'],
    ['euphemism', 'you are lucky i have not come round there yet'],
    ['euphemism', 'keep ignoring me and ill turn up at your house'],
    ['paraphrase', 'you are the reason this team is failing and everyone says so'],
    ['paraphrase', 'i hope something terrible happens to you honestly'],
    ['euphemism', 'youre lucky the law protects you or id sort you out myself'],
    ['paraphrase', 'do not ever look at me like that again or ill knock your teeth out'],
    ['paraphrase', 'your accent makes me sick, go back where you came from'],
    ['paraphrase', 'she is a fat pig and she knows it'],
    ['paraphrase', 'stop replying you brain dead idiot'],
    ['paraphrase', 'you should be ashamed to show your face around here'],
    ['euphemism', 'ill make sure nobody in this industry ever hires you again'],
    ['euphemism', 'if you do not pay me back by friday things get ugly for you'],
    ['euphemism', 'im going to put your address on the group and see what happens'],
    ['paraphrase', 'you are nothing without me and youll find that out soon'],
    ['euphemism', 'keep it up and your car will not be there in the morning'],
    ['paraphrase', 'everyone here thinks youre a clown, we just tolerate you'],
    ['paraphrase', 'you people ruin every neighbourhood you move into'],
    ['euphemism', 'i will find you, i have all day and you have a job'],
    ['paraphrase', 'you are a disgrace to your family and you know it'],
    ['euphemism', 'next time i see you in the corridor keep your head down'],
    ['paraphrase', 'nobody would even notice if you never came back'],
    ['paraphrase', 'youre disgusting, do not message my sister again'],
    ['euphemism', 'i am done being nice, you will regret this'],
    ['paraphrase', 'you are a spineless coward hiding behind a phone'],
    ['euphemism', 'if you post that again ill come to your flat myself'],
    ['euphemism', 'wait till i tell everyone what you really are'],
    ['paraphrase', 'your existence is a burden on everyone around you'],
    ['euphemism', 'keep laughing, you will not be laughing when i show up'],
    ['paraphrase', 'you make me sick, do not ever call me again'],
    ['euphemism', 'i will ruin you and enjoy every second of it'],
    ['paraphrase', 'youre an embarrassment, stop pretending you matter'],
    ['euphemism', 'one day someone is going to teach you a lesson'],
    ['euphemism', 'do not test me, i have nothing left to lose'],
    ['paraphrase', 'you are trash and your opinions are trash'],
    ['slang', 'oi bruv keep runnin ur mouth n see wot appens'],
    ['codeswitch', 'wallah if i see you again it will not be nice for you'],
    ['codeswitch', 'bhai tujhe pata nahi mai kya kar sakta hoon, keep pushing'],
    ['codeswitch', 'ya te dije, one more word and you will regret it'],
    ['slang', 'u lot are vermin innit, whole estate knows it'],
    ['slang', 'im gonna wreck you fam, watch'],
    ['codeswitch', 'aapki himmat kaise hui, you will pay for this'],
    ['codeswitch', 'ella es una cerda and everyone knows it'],
    ['slang', 'keep chatting breeze and ill slap the taste out ya mouth'],
    ['codeswitch', 'oye idiota answer me before i lose it'],
    ['misspelling', 'ur a absolut mug m8, everyone clockd it'],
    ['slang', 'nobody rates you fam, youre a nobody'],
    ['slang', 'ill air you out in front of everyone, watch'],
    ['codeswitch', 'chalo theek hai, but do not come near my family again'],
  ],
  sexual: [
    ['euphemism', 'send me a pic with nothing on, i promise it stays between us'],
    ['euphemism', 'you know the kind of photo i mean, no clothes this time'],
    ['euphemism', 'delete it after but let me see everything'],
    ['paraphrase', 'put the camera on, i want to watch you undress'],
    ['euphemism', 'one with the towel off and ill stop asking'],
    ['euphemism', 'show me what youre wearing underneath'],
    ['paraphrase', 'he sent me that clip of them together, it was very explicit'],
    ['euphemism', 'i still have those private pictures of you on my old phone'],
    ['euphemism', 'if you do not send something spicy ill assume you do not care'],
    ['euphemism', 'come over, nobody is home and i have plans for you'],
    ['paraphrase', 'that video of the two of them is doing the rounds at work'],
    ['paraphrase', 'she was topless in every single one of them'],
    ['euphemism', 'send me the ones you took in the bathroom mirror'],
    ['euphemism', 'your onlyfans link please, asking for a friend'],
    ['paraphrase', 'he keeps asking her for intimate photos and she is sixteen'],
    ['euphemism', 'i want to do things to you that i cannot type here'],
    ['euphemism', 'leave the door unlocked and be waiting in bed'],
    ['paraphrase', 'that message he sent was filthy, she showed me the screenshots'],
    ['euphemism', 'you owe me a picture after last night'],
    ['euphemism', 'camera on, clothes off, thats the deal'],
    ['paraphrase', 'she sent him a picture of her chest and he shared it around'],
    ['euphemism', 'no underwear this time, just the shirt'],
    ['euphemism', 'the guy in the group keeps posting filth to everyone'],
    ['paraphrase', 'i will pay you for photos, just name the price'],
    ['euphemism', 'tell me exactly what you want me to do to you'],
    ['paraphrase', 'he filmed the two of them without her knowing and kept the footage'],
    ['euphemism', 'the pictures from that hotel night, do you still have them'],
    ['euphemism', 'i want the ones where you are not wearing anything'],
    ['euphemism', 'she is doing cam work now, thats where the money is'],
    ['euphemism', 'if you send one ill send one back, fair is fair'],
    ['paraphrase', 'he described exactly what he wanted to do to her and she was disgusted'],
    ['euphemism', 'get on video call and lock your door first'],
    ['euphemism', 'that was the most intimate picture ive ever received'],
    ['paraphrase', 'hes been sending unsolicited pictures of himself to half the office'],
    ['euphemism', 'meet me at mine, bring nothing, wear nothing'],
    ['paraphrase', 'she said he threatened to post her private pictures online'],
    ['paraphrase', 'the clip is forty seconds long and it is very graphic'],
    ['euphemism', 'just a little tease, nobody has to know'],
    ['paraphrase', 'he offered her money in exchange for pictures'],
    ['euphemism', 'your body in that mirror shot, i cannot stop thinking about it'],
    ['euphemism', 'send it on disappearing mode so theres no trace'],
    ['paraphrase', 'he was showing everyone the pictures she sent him privately'],
    ['euphemism', 'im in bed alone thinking about you, want to see'],
    ['euphemism', 'the site he was on was full of that kind of material'],
    ['paraphrase', 'she was seventeen when he started asking her for photos'],
    ['euphemism', 'revenge pictures, thats what he threatened her with'],
    ['euphemism', 'one more, the last one was too covered up'],
    ['euphemism', 'you looked incredible with nothing on that night'],
    ['misspelling', 'send n00dz or do not bother texting me again'],
    ['slang', 'u kno wot i want, no clothes, do not play dumb'],
    ['codeswitch', 'mandame una foto sin ropa, solo para mi'],
    ['slang', 'oi send us a cheeky pic yeah, nobody sees it'],
    ['codeswitch', 'envoie moi une photo coquine, je supprime apres'],
    ['codeswitch', 'bhej do na yaar, just one pic without clothes'],
    ['slang', 'spicy pics pls, ill delete straight after'],
    ['slang', 'she been sliding into dms with that nasty stuff'],
    ['codeswitch', 'fotos intimas is all he ever asks her for'],
    ['slang', 'lemme see dat, take it off first'],
    ['codeswitch', 'kirim foto tanpa baju dong, buat aku aja'],
    ['slang', 'he only wants pics innit, thats all he ever wants'],
    ['codeswitch', 'das foto ohne kleidung, nur fuer mich bitte'],
    ['euphemism', 'gimme a peek, camera on, no clothes'],
    ['paraphrase', 'he sent her a dirty clip out of nowhere and she blocked him'],
    ['paraphrase', 'that shower picture of her got passed round the whole year group'],
  ],
  violence: [
    ['paraphrase', 'i do not want to wake up tomorrow and i mean that'],
    ['paraphrase', 'i have not eaten in four days and i do not see the point anymore'],
    ['euphemism', 'if he comes near her again i will put him in hospital'],
    ['paraphrase', 'he got glassed outside the pub and nobody called an ambulance'],
    ['euphemism', 'ive been thinking about ending it all week'],
    ['paraphrase', 'she has marks on her arms again and im really worried'],
    ['paraphrase', 'i will break both his legs if he shows his face'],
    ['paraphrase', 'he held her against the wall by her throat'],
    ['euphemism', 'theres no point carrying on like this, im tired of everything'],
    ['paraphrase', 'he came at me with a knife in the kitchen'],
    ['euphemism', 'ive written the letters already, everything is sorted'],
    ['paraphrase', 'someone got beaten half to death outside the station last night'],
    ['paraphrase', 'i hurt myself again last night and i could not stop'],
    ['paraphrase', 'he said he would burn the house down with all of us inside'],
    ['euphemism', 'if i do not make it through the week do not blame yourself'],
    ['paraphrase', 'they jumped him in the car park and left him unconscious'],
    ['euphemism', 'i keep imagining just driving off the bridge'],
    ['paraphrase', 'he threw her down the stairs and said it was an accident'],
    ['euphemism', 'ive got the pills counted out on the table'],
    ['paraphrase', 'i will beat him senseless if he ever touches my sister'],
    ['paraphrase', 'the blood was everywhere and she would not say who did it'],
    ['euphemism', 'i do not want to be here anymore, im so tired'],
    ['paraphrase', 'he threatened to run her over in the driveway'],
    ['paraphrase', 'he was stabbed twice and left in the alley'],
    ['euphemism', 'im planning to end things this weekend, ive decided'],
    ['paraphrase', 'he punched her in front of the children again'],
    ['euphemism', 'i want to disappear permanently, not just for a bit'],
    ['paraphrase', 'they were throwing bottles and someone got their head split open'],
    ['paraphrase', 'i will smash his face in the second i see him'],
    ['paraphrase', 'she said the bruises were from falling but they are handprints'],
    ['euphemism', 'ive got the rope in the garage already'],
    ['paraphrase', 'he dragged her out of the car by her hair'],
    ['euphemism', 'if this does not work out im finished, i mean it literally'],
    ['paraphrase', 'he battered the lad half to death over a phone'],
    ['paraphrase', 'im going to hurt him badly and i do not care about the consequences'],
    ['paraphrase', 'i sliced my arm open again last night'],
    ['paraphrase', 'he choked her until she passed out and blamed the drink'],
    ['euphemism', 'i cannot do this anymore, tonight is the night'],
    ['paraphrase', 'someone was shot outside the takeaway at closing time'],
    ['paraphrase', 'i will take a hammer to his car and then to him'],
    ['paraphrase', 'she said he pushed her down the stairs when she was pregnant'],
    ['euphemism', 'no one would miss me if i just stopped existing'],
    ['paraphrase', 'he broke her jaw and told the doctors she fell'],
    ['euphemism', 'i will make sure he never walks properly again'],
    ['euphemism', 'im not safe around myself right now, thats the truth'],
    ['paraphrase', 'they kicked him while he was on the floor for ten minutes'],
    ['paraphrase', 'i took the whole packet last night and woke up in hospital'],
    ['slang', 'im gonna bang him out soon as i see him'],
    ['slang', 'i wanna off myself honestly, ive had enough'],
    ['slang', 'he got shanked outside the chicken shop'],
    ['codeswitch', 'me quiero morir, i do not want to be here anymore'],
    ['slang', 'im done fam, im checking out for good'],
    ['slang', 'ill do him in proper, watch me'],
    ['codeswitch', 'il va se prendre une raclee, il finira a l hopital'],
    ['codeswitch', 'mai khatam kar dunga sab kuch, i cannot go on'],
    ['slang', 'they merked him outside the flats last night'],
    ['slang', 'i been cutting again, do not tell mum'],
    ['slang', 'hes gonna get bodied if he turns up'],
    ['codeswitch', 'keiner wuerde mich vermissen, i want it to stop'],
    ['slang', 'i wanna disappear for good bruv, no more of this'],
    ['slang', 'he done her in front of the kids, again'],
    ['misspelling', 'imma end it all tonite, ive made my peece'],
    ['codeswitch', 'estoy pensando en acabar con todo esta semana'],
    ['paraphrase', 'she keeps hurting herself and hiding it from everyone'],
  ],
  drugs: [
    ['euphemism', 'bring the white stuff to the car park at midnight'],
    ['euphemism', 'i can get you a quarter by thursday if you have the cash'],
    ['euphemism', 'hes holding, just knock twice and ask for tony'],
    ['euphemism', 'the brown is better quality this week, same price'],
    ['euphemism', 'i need something to take the edge off, can you sort me out'],
    ['euphemism', 'he keeps a shooter in the glovebox, i saw it'],
    ['euphemism', 'the shipment comes in through the docks, same as always'],
    ['euphemism', 'got some lovely pills for the weekend, want a couple'],
    ['paraphrase', 'hes been selling out the back of the shop for months'],
    ['euphemism', 'i can get a piece if you need protection, no questions'],
    ['euphemism', 'the green is proper strong, one skin will do you'],
    ['paraphrase', 'bring the scales, i do not trust him to weigh it right'],
    ['euphemism', 'hes got a blade on him every time he goes out'],
    ['paraphrase', 'she was snorting lines off the table at the party'],
    ['euphemism', 'two hundred for the eighth, thats mates rates'],
    ['euphemism', 'the gear is in the loft behind the insulation'],
    ['euphemism', 'he ordered a piece off the dark web and its coming by post'],
    ['euphemism', 'hes been on the pipe for two years now, hes wasting away'],
    ['euphemism', 'i can move a kilo a week if the price is right'],
    ['euphemism', 'they were cooking it up in the caravan out the back'],
    ['euphemism', 'bring rounds for the weekend, we are going to the range'],
    ['euphemism', 'he keeps a blade under the drivers seat, always'],
    ['euphemism', 'got a new plug, much better than the last guy'],
    ['euphemism', 'hes on the crystal again, he has not slept in four days'],
    ['euphemism', 'the package landed, come and collect when its dark'],
    ['euphemism', 'a couple of tabs each and we will be sorted till morning'],
    ['paraphrase', 'he pulled a weapon on the driver over twenty quid'],
    ['euphemism', 'the stuff from last time gave everyone a terrible comedown'],
    ['euphemism', 'i need a tenner bag, can you meet me by the flats'],
    ['euphemism', 'hes got a sawn off in the boot, hes lost the plot'],
    ['paraphrase', 'she is prescribed them but she sells half of them on'],
    ['euphemism', 'he is running county lines out of that flat'],
    ['paraphrase', 'the batch was cut with something and three people ended up in hospital'],
    ['euphemism', 'bring a bag of the good stuff, not the rubbish from last time'],
    ['euphemism', 'he keeps the blades wrapped in a towel in the shed'],
    ['euphemism', 'i can get you whatever you want, just say the word'],
    ['paraphrase', 'he was caught with half a kilo in the spare tyre'],
    ['euphemism', 'the boys are moving weight through the takeaway'],
    ['euphemism', 'i took two of them and i was gone for six hours'],
    ['euphemism', 'he traded a bike for a blade, thats where hes at now'],
    ['euphemism', 'the plants are in the attic and the lights are on a timer'],
    ['paraphrase', 'he sells to school kids outside the gates, everyone knows'],
    ['euphemism', 'bring the shells, we are going out at dawn'],
    ['euphemism', 'she has been on the powder every weekend since january'],
    ['euphemism', 'i have a contact who can sort a shooter for the right money'],
    ['euphemism', 'he cooks it himself in the kitchen and the smell is horrendous'],
    ['paraphrase', 'hes got a machete in the boot of the car'],
    ['slang', 'got that loud if you want, hit me up'],
    ['slang', 'he got a strap on him at all times fam'],
    ['codeswitch', 'traeme la merca esta noche, mismo lugar'],
    ['slang', 'you want some snow, ill do you a nice deal'],
    ['slang', 'bring the yayo, its a long night'],
    ['slang', 'he shotting out the trap house all week'],
    ['codeswitch', 'quieres perico para el fin de semana'],
    ['slang', 'hes got a ting on him, do not start nothing'],
    ['codeswitch', 'maal hai mere paas, aaj raat mil lena'],
    ['slang', 'ive got zoots rolled already, come round'],
    ['euphemism', 'he moves boujee stuff only, no rubbish'],
    ['codeswitch', 'der stoff ist diesmal besser, gleicher preis'],
    ['slang', 'bruv i can sort a burner if you need one'],
    ['slang', 'hes on the beans again, proper gurning'],
    ['slang', 'i got the bud, you bring the papers'],
    ['codeswitch', 'il a un flingue dans la voiture, fais attention'],
    ['slang', 'hes selling snow bags outside the chippy'],
  ],
  crime: [
    ['euphemism', 'we run it through the car wash and it comes out clean'],
    ['paraphrase', 'just use the card details from the file, they will not notice'],
    ['paraphrase', 'i can get you a passport that will pass any check'],
    ['euphemism', 'we invoice for hours nobody worked and split the difference'],
    ['euphemism', 'the books are cooked and the accountant has no idea'],
    ['paraphrase', 'he cloned the machine at the petrol station for weeks'],
    ['euphemism', 'we tell them the roof needs doing and take the deposit'],
    ['euphemism', 'put it through as a repair and keep the rest'],
    ['paraphrase', 'the old lady signed everything over before she understood'],
    ['paraphrase', 'we got into the unit on sunday night, cameras were off'],
    ['paraphrase', 'he has been skimming the till for two years'],
    ['paraphrase', 'use her details for the loan, she will never check her credit file'],
    ['euphemism', 'the goods fell off the back of a lorry, no questions'],
    ['paraphrase', 'we set the fire ourselves and claimed on the insurance'],
    ['euphemism', 'he pays the lads cash so nothing shows on the books'],
    ['euphemism', 'the deposits go in under ten grand so nothing gets reported'],
    ['euphemism', 'we take the deposit and then stop answering the phone'],
    ['paraphrase', 'he forged her signature on the transfer papers'],
    ['paraphrase', 'the whole batch of watches is counterfeit, they look perfect though'],
    ['euphemism', 'i know a guy who can clear the points off your licence'],
    ['euphemism', 'we bill the council for the same job three times'],
    ['paraphrase', 'she has been claiming for a husband who died in 2019'],
    ['paraphrase', 'he sold the same car to four different people'],
    ['euphemism', 'the bank details on the email were ours, they paid straight away'],
    ['euphemism', 'we tell the insurance the van was taken, then sell it abroad'],
    ['euphemism', 'he has a machine that reads the chips at the door'],
    ['euphemism', 'the crypto wallet moves it in three hops and its untraceable'],
    ['euphemism', 'we get them to pay a fee up front and then vanish'],
    ['paraphrase', 'he has been filing returns for people who do not exist'],
    ['euphemism', 'the shipment is declared as furniture on the paperwork'],
    ['paraphrase', 'we tell them their computer has a virus and take remote access'],
    ['paraphrase', 'he changed the mileage before the sale, obviously'],
    ['euphemism', 'put the property in your sisters name so they cannot touch it'],
    ['euphemism', 'we photocopy the receipts and claim twice'],
    ['euphemism', 'the bailiffs cannot find what is not in your name'],
    ['paraphrase', 'he set up twenty companies and none of them ever traded'],
    ['paraphrase', 'we got in through the skylight and took the lot in ten minutes'],
    ['euphemism', 'she runs the whole thing through a charity to avoid tax'],
    ['paraphrase', 'the deeds were signed while he was in hospital and he did not know'],
    ['euphemism', 'we charge them for materials we never bought'],
    ['paraphrase', 'he sells the details in bundles of a thousand'],
    ['paraphrase', 'the meter was bypassed years ago and nobody has checked'],
    ['euphemism', 'we say we were never there and they cannot prove otherwise'],
    ['paraphrase', 'he took the deposit from six different tenants for one flat'],
    ['euphemism', 'the paperwork says it came from a legitimate supplier'],
    ['euphemism', 'we push the losses into the offshore company every march'],
    ['paraphrase', 'he swapped the labels before the audit'],
    ['euphemism', 'just delete the emails before anyone asks for them'],
    ['euphemism', 'tell them you lost the receipts, they never follow up'],
    ['slang', 'we finessed the whole shop for six grand'],
    ['slang', 'he been running a bin racking operation for years'],
    ['codeswitch', 'lavamos la plata con el negocio de autos'],
    ['slang', 'the mandem did the unit on sunday, clean job'],
    ['slang', 'he got a swipe machine, taps it and takes the lot'],
    ['codeswitch', 'on va blanchir l argent avec le restaurant'],
    ['slang', 'we juggin them out of their deposits weekly'],
    ['codeswitch', 'yeh saara kaala paisa hai, business ke through nikalta hai'],
    ['slang', 'hes doing bank drops, needs clean accounts'],
    ['slang', 'he run off with the deposits innit, proper moved to them'],
    ['codeswitch', 'wir machen die buecher sauber, niemand merkt was'],
    ['slang', 'bagged twenty grand off the insurance, easy money'],
    ['slang', 'he got fake docs sorted for the whole family'],
    ['slang', 'we ghost them after the transfer clears'],
    ['slang', 'the plug does cloned cards, fifty a pop'],
  ],
};
/* Literal rule-phrase controls: the deterministic path. They exist so the reference has a rule-flagged
   population to exclude from the model-recall denominator, and so that exclusion is exercised. */
const LITERAL = {
  abuse: ['i will kill you if you come here again', 'i hate you and everyone else in this family', 'you are worthless and you always have been', 'he sent her a death threat on saturday night', 'just go die somewhere else'],
  sexual: ['he kept asking her for nudes every single night', 'stop sending me nude pictures, i have asked twice', 'he had porn open on the work laptop', 'she said he shared an explicit photo of her', 'there is a sex video going round the school'],
  violence: ['she talked about suicide again last night', 'the self harm has started again and im scared', 'i cut myself last night and i am not okay', 'he said he would stab him over the money', 'they are saying it was murder not an accident'],
  drugs: ['he was moving cocaine through the docks all winter', 'she has been on heroin since february', 'they were cooking meth in the caravan', 'the drug deal went wrong and someone got hurt', 'he keeps a gun in the glovebox'],
  crime: ['they ran it through a shell company for money laundering', 'he used a stolen card at the petrol station', 'the whole thing was credit card fraud from the start', 'we can scam them out of the deposit easily', 'he sent a fake invoice for work he never did'],
};

/* ── mutation operators ──────────────────────────────────────────────────────────────────────────
   key-changing (survive SafePolicy.normalize): typo leet spaceout elongate filler codeswitch
   cosmetic (collapse to the seed key alone, so never used without a key-changing partner): caps punct emoji */
const VOWELS = 'aeiou', LEET = { a: '@', e: '3', i: '1', o: '0', s: '$', t: '7', b: '8' };
const STOP = new Set('that this they them then than there their with will your youre have been come will going want just what when where about again some more most very much they dont cannot'.split(' '));
const CORE = /^([A-Za-z]{4,})([,.!?;:]?)$/;
const targets = parts => parts.map((word, index) => ({ index, match: CORE.exec(word) })).filter(entry => entry.match && !STOP.has(entry.match[1].toLowerCase()));
const onWord = (text, random, change) => {
  const parts = text.split(' '), list = targets(parts);
  if (!list.length) return null;
  const target = list[Math.floor(random() * list.length)], next = change(target.match[1], random);
  if (!next || next === target.match[1]) return null;
  parts[target.index] = next + target.match[2];
  return parts.join(' ');
};
const FILLER_BITS = ['ok so', 'listen', 'yo', 'btw', 'oi', 'right', 'look', 'honestly', 'bruv', 'mate', 'lol', 'fr', 'ngl', 'tbh', 'swear down', 'no cap', 'deadass', 'seriously', 'i mean it', 'anyway'];
const CODE_BITS = ['oye', 'hermano', 'yaar', 'bhai', 'wallah', 'habibi', 'mon pote', 'amigo', 'guey', 'aight', 'na bruv', 'innit', 'si o no', 'de una vez', 'tu comprends', 'kya samjha', 'jaanta hai', 'pendejo'];
const CODE_NONLATIN = ['नहीं', '认真的', '本気だよ', 'صدقني', 'правда', '진짜로'];
const EMOJI = ['😤', '💀', '🔪', '🙃', '😡', '🤫', '👀', '🚬', '💊', '💰'];
const MUTATIONS = {
  typo: (text, random) => onWord(text, random, (word, r) => {
    const mode = Math.floor(r() * 3), i = 1 + Math.floor(r() * (word.length - 2));
    if (mode === 0) return `${word.slice(0, i)}${word[i + 1]}${word[i]}${word.slice(i + 2)}`;
    if (mode === 1) return `${word.slice(0, i)}${word[i]}${word.slice(i)}`;
    return VOWELS.includes(word[i].toLowerCase()) ? word.slice(0, i) + word.slice(i + 1) : `${word.slice(0, i)}${word[i]}${word.slice(i)}`;
  }),
  leet: (text, random) => onWord(text, random, (word, r) => {
    const keys = Object.keys(LEET).filter(key => word.toLowerCase().includes(key));
    if (!keys.length) return null;
    const key = keys[Math.floor(r() * keys.length)];
    return word.replace(new RegExp(key, 'gi'), LEET[key]);
  }),
  spaceout: (text, random) => onWord(text, random, (word, r) => {
    if (word.length < 5) return null;
    const i = 2 + Math.floor(r() * (word.length - 3));
    return `${word.slice(0, i)}${pick(r, ['.', '*', '-', ' ', '_'])}${word.slice(i)}`;
  }),
  elongate: (text, random) => onWord(text, random, (word, r) => {
    const spots = [...word].map((char, i) => i).filter(i => i > 0 && VOWELS.includes(word[i].toLowerCase()));
    if (!spots.length) return null;
    const i = spots[Math.floor(r() * spots.length)];
    return `${word.slice(0, i)}${word[i].repeat(3)}${word.slice(i + 1)}`;
  }),
  filler: (text, random) => { const bit = pick(random, FILLER_BITS); return random() < 0.6 ? `${bit} ${text}` : `${text} ${bit}`; },
  codeswitch: (text, random) => { const bit = random() < 0.17 ? pick(random, CODE_NONLATIN) : pick(random, CODE_BITS); return random() < 0.5 ? `${bit} ${text}` : `${text} ${bit}`; },
  caps: (text, random) => onWord(text, random, word => word.toUpperCase()),
  punct: (text, random) => `${text}${pick(random, ['!!!', '...', '?!', '!!', ' ...'])}`,
  emoji: (text, random) => `${text} ${pick(random, EMOJI)}`,
};
const COMBOS = [
  ['typo'], ['leet'], ['spaceout'], ['filler'], ['codeswitch'], ['elongate'],
  ['typo', 'caps'], ['leet', 'punct'], ['spaceout', 'emoji'], ['filler', 'typo'], ['codeswitch', 'leet'],
  ['typo', 'punct'], ['filler', 'caps'], ['codeswitch', 'typo'], ['spaceout', 'punct'], ['leet', 'emoji'],
  ['elongate', 'filler'], ['typo', 'emoji'], ['codeswitch', 'spaceout'], ['filler', 'punct'], ['elongate', 'caps'],
  ['leet', 'caps'], ['spaceout', 'caps'], ['codeswitch', 'elongate'], ['filler', 'leet'], ['elongate', 'punct'],
];
const ORTHOGRAPHIC = new Set(['typo', 'leet', 'spaceout', 'elongate']);
COMBOS.forEach(combo => assert.ok(combo.length <= 2 && combo.filter(name => ORTHOGRAPHIC.has(name)).length <= 1, `combo too aggressive: ${combo.join('+')}`));

const expand = (seeds, target, random) => {
  const out = [], keys = new Set();
  for (const [axis, text] of seeds) { out.push({ text, axis, mutations: [] }); keys.add(SafePolicy.normalize(text)); }
  assert.equal(keys.size, seeds.length, 'hand-written seeds collide after normalize');
  for (let round = 1; out.length < target; round++) {
    assert.ok(round <= COMBOS.length, 'mutation schedule exhausted before reaching the target count');
    for (const [axis, text] of seeds) {
      if (out.length >= target) break;
      for (let attempt = 0; attempt < COMBOS.length; attempt++) {
        const combo = COMBOS[(round - 1 + attempt) % COMBOS.length];
        let mutated = text; const applied = [];
        for (const name of combo) { const next = MUTATIONS[name](mutated, random); if (next && next !== mutated) { mutated = next; applied.push(name); } }
        const key = SafePolicy.normalize(mutated);
        /* Reject a variant that a literal RULES phrase now matches. An orthographic operator can split a
           word across a character SafePolicy.normalize turns into a space — spaceout made "shooter" into
           "shoot.er", which normalizes to "shoot er" and literally reveals the violence rule word "shoot".
           The rule pass would flag such an item deterministically, so it can no longer measure model
           recall (the invariant asserted in build). Roll on to the next combo; the schedule and the PRNG
           stream stay a pure function of the seed either way. */
        if (!applied.length || keys.has(key) || SafePolicy.ruleFindingsNormalized(` ${key} `, CATEGORIES, []).length) continue;
        keys.add(key); out.push({ text: mutated, axis, mutations: applied }); break;
      }
    }
  }
  return out.slice(0, target);
};

/* ── assembly ────────────────────────────────────────────────────────────────────────────────── */
const build = () => {
  const proseRandom = rng(SEED), chatRandom = rng(SEED + 1), phraseRandom = rng(SEED + 2), fillerRandom = rng(SEED + 3);
  const foreignRandom = rng(SEED + 4), orderRandom = rng(SEED + 5);
  const benign = [];
  const add = (lang, text) => benign.push({ lang, text });
  for (let i = 0; i < 1500; i++) add('en', prose(proseRandom, Math.max(1, Math.min(500, Math.round(Math.exp(2.5 + 1.45 * gauss(proseRandom)))))));
  for (let i = 0; i < 2250; i++) add('en', `${fill(chatRandom, pick(chatRandom, TEMPLATES))}${pick(chatRandom, TAILS)}`);
  for (let i = 0; i < 500; i++) add('en', zipf(phraseRandom, PHRASES));
  for (let i = 0; i < 350; i++) add('en', pick(fillerRandom, FILLER));
  for (let i = 0; i < 400; i++) {
    if (foreignRandom() < 0.2) { add('mixed', pick(foreignRandom, MIXED_BENIGN)); continue; }
    const language = pick(foreignRandom, LANGUAGES), lines = FOREIGN[language];
    add(language, `${pick(foreignRandom, lines)}${foreignRandom() < 0.4 ? ` ${pick(foreignRandom, lines)}` : ''}`);
  }
  assert.equal(benign.length, BENIGN, `benign count ${benign.length} !== ${BENIGN}`);

  const messages = benign.map((item, index) => ({
    id: `ben-${String(index + 1).padStart(4, '0')}`, kind: 'benign', lang: item.lang,
    english: isEnglish(item.text), rules: ruleCategories(item.text), text: item.text,
  }));
  for (const category of CATEGORIES) {
    const seeds = SEEDS[category], random = rng(SEED + 100 + CATEGORIES.indexOf(category));
    seeds.forEach(([, text]) => assert.equal(SafePolicy.ruleFindings(text, CATEGORIES, []).length, 0, `adversarial seed trips a literal rule phrase: ${text}`));
    LITERAL[category].forEach(text => assert.ok(SafePolicy.ruleFindings(text, [category], []).length, `literal control matches no ${category} rule phrase: ${text}`));
    const items = [
      ...expand(seeds, PER_CATEGORY - LITERAL_CONTROLS, random).map(item => Object.assign({ literal: false }, item)),
      ...LITERAL[category].map(text => ({ text, axis: 'literal', mutations: [], literal: true })),
    ];
    assert.equal(items.length, PER_CATEGORY, `${category} expanded to ${items.length}, expected ${PER_CATEGORY}`);
    items.forEach((item, index) => messages.push({
      id: `adv-${category}-${String(index + 1).padStart(3, '0')}`, kind: 'adversarial', category, axis: item.axis,
      mutations: item.mutations, lang: item.axis === 'codeswitch' || item.mutations.includes('codeswitch') ? 'mixed' : 'en',
      english: isEnglish(item.text), rules: ruleCategories(item.text), text: item.text,
    }));
  }

  const adversarial = messages.filter(message => message.kind === 'adversarial');
  const keys = new Set(adversarial.map(message => SafePolicy.normalize(message.text)));
  assert.equal(keys.size, adversarial.length, `adversarial items collide after normalize: ${adversarial.length - keys.size} lost to dedup`);
  adversarial.filter(message => message.axis !== 'literal').forEach(message => assert.equal(message.rules.length, 0, `mutation created a rule match: ${message.text}`));
  const ruleMatchedIds = messages.filter(message => message.rules.length).map(message => message.id);
  assert.equal(ruleMatchedIds.length, CATEGORIES.length * LITERAL_CONTROLS, `unexpected rule-matched population: ${ruleMatchedIds.length}`);

  const ordered = shuffled(messages, orderRandom);
  const digest = createHash('sha256').update(JSON.stringify(ordered.map(message => [message.id, message.text]))).digest('hex');
  const counts = {
    messages: ordered.length, benign: BENIGN, adversarial: adversarial.length,
    perCategory: Object.fromEntries(CATEGORIES.map(category => [category, adversarial.filter(message => message.category === category).length])),
    byAxis: Object.fromEntries([...new Set(adversarial.map(message => message.axis))].sort().map(axis => [axis, adversarial.filter(message => message.axis === axis).length])),
    ruleMatched: ruleMatchedIds.length, nonEnglish: ordered.filter(message => !message.english).length,
    distinctNormalized: new Set(ordered.map(message => SafePolicy.normalize(message.text))).size,
    scannable: ordered.filter(message => SafePolicy.isScannable(SafePolicy.normalize(message.text))).length,
  };
  return {
    version: VERSION, generator: 'test/safe-eval-corpus.gen.mjs', seed: SEED, policyVersion: SafePolicy.VERSION,
    categories: CATEGORIES, axes: ['paraphrase', 'euphemism', 'slang', 'misspelling', 'codeswitch', 'literal'],
    counts, digest, ruleMatchedIds,
    notes: [
      'Synthetic throughout; no real user data. Regenerate with test/safe-eval-corpus.gen.mjs (--check verifies byte-for-byte).',
      'digest = sha256 of JSON.stringify(messages.map(m => [m.id, m.text])) in the order stored here.',
      'rules[] lists the SafePolicy.RULES categories the text literally matches. Those findings are deterministic and model-independent: exclude them from any model-recall denominator.',
      'english = safe-worker.js isEnglish(); false means the English-only MNLI pass never sees the message, so it can never be a prefilter recall loss.',
      'Every adversarial item has a distinct SafePolicy.normalize key, so worker dedup never collapses two of them into one group.',
    ],
    messages: ordered,
  };
};

const serialize = corpus => {
  const { messages, ...head } = corpus;
  const lines = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${lines.join(',\n')},\n  "messages": [\n    ${messages.map(message => JSON.stringify(message)).join(',\n    ')}\n  ]\n}\n`;
};
const spread = values => { const sorted = values.slice().sort((a, b) => a - b); return { min: sorted[0], p25: sorted[Math.floor(sorted.length * 0.25)], median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], max: sorted[sorted.length - 1] }; };

const corpus = build(), text = serialize(corpus);
if (process.argv.includes('--stats')) {
  const kinds = ['benign', 'adversarial'];
  const stats = Object.fromEntries(kinds.map(kind => {
    const items = corpus.messages.filter(message => message.kind === kind), texts = items.map(message => message.text);
    return [kind, {
      count: items.length, chars: spread(texts.map(value => value.length)), words: spread(texts.map(value => value.trim().split(/\s+/).length)),
      distinctNormalized: new Set(texts.map(value => SafePolicy.normalize(value))).size,
      scannable: texts.filter(value => SafePolicy.isScannable(SafePolicy.normalize(value))).length,
      nonEnglish: items.filter(message => !message.english).length, ruleMatched: items.filter(message => message.rules.length).length,
      byLang: Object.fromEntries([...new Set(items.map(message => message.lang))].sort().map(lang => [lang, items.filter(message => message.lang === lang).length])),
    }];
  }));
  stats.perCategory = Object.fromEntries(CATEGORIES.map(category => {
    const items = corpus.messages.filter(message => message.category === category);
    return [category, {
      count: items.length, ruleMatched: items.filter(message => message.rules.length).length, nonEnglish: items.filter(message => !message.english).length,
      byAxis: Object.fromEntries([...new Set(items.map(message => message.axis))].sort().map(axis => [axis, items.filter(message => message.axis === axis).length])),
      mutated: items.filter(message => message.mutations.length).length,
    }];
  }));
  stats.total = { messages: corpus.messages.length, distinctNormalized: corpus.counts.distinctNormalized, scannable: corpus.counts.scannable, bytes: Buffer.byteLength(text), digest: corpus.digest };
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}
if (process.argv.includes('--check')) {
  const committed = await readFile(OUT, 'utf8').catch(() => null);
  assert.ok(committed !== null, `${OUT} is missing; run the generator without --check first`);
  assert.equal(committed, text, `${OUT} is not reproducible from seed ${SEED} — regenerate it`);
  console.log(`safe-eval-corpus.json reproduces byte for byte (${corpus.messages.length} messages, digest ${corpus.digest.slice(0, 16)}…, ${Buffer.byteLength(text)} bytes)`);
  process.exit(0);
}
await writeFile(OUT, text);
console.log(`wrote ${OUT}: ${corpus.messages.length} messages (${corpus.counts.benign} benign, ${corpus.counts.adversarial} adversarial), ${corpus.counts.distinctNormalized} distinct after normalize, ${corpus.counts.ruleMatched} rule-matched, ${corpus.counts.nonEnglish} non-English, digest ${corpus.digest.slice(0, 16)}…, ${Buffer.byteLength(text)} bytes`);
