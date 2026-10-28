/*
 * The SMS card a patient keeps by the phone, in the language they read. It
 * is printed from the clinic app but read by the patient, so it uses the
 * patient app's words for the same things: the times of a reading, the
 * months. The codes stay in Latin letters in every language, because that
 * is what the SMS reader accepts (api/src/healthathon/sms/parser.py).
 *
 * Hindi and Urdu are DRAFTS, NOT REVIEWED BY A SPEAKER, like the patient
 * app's. The page says so before printing, and a test keeps REVIEWED false
 * until a speaker has reviewed every string.
 */
export type CardLang = 'en' | 'hi' | 'ur'

export const CARD_LANGS: CardLang[] = ['en', 'hi', 'ur']

export const REVIEWED: Record<CardLang, boolean> = { en: true, hi: false, ur: false }

/* The parser's letters for when a reading was taken, in the order printed. */
export const WHEN_LETTERS = ['F', 'B', 'A', 'N', 'O', 'R'] as const

const en = {
  langName: 'English',
  title: 'Send your diary by SMS',
  sendTo: 'Send your messages to',
  from: 'Send them from your phone ending in {last4}. Messages from another phone are not read.',
  howTo: 'Write each thing on its own line. One message can carry several lines. Capital or small letters both work.',
  reading: {
    title: 'A sugar reading',
    how: 'G, then the number from your meter, then a letter for when you took it.',
    example: '142 is only an example. Send the number your meter shows.',
    when: {
      F: 'Before breakfast',
      B: 'Before a meal',
      A: 'After a meal',
      N: 'At bedtime',
      O: 'At night',
      R: 'Another time',
    },
    needLetter: 'A reading without one of these letters is not saved.',
  },
  medicine: {
    title: 'A medicine',
    how: 'T, then the medicine’s number below, then Y if you took it or N if you did not.',
    list: 'Your medicines, from your list of {date}',
    change: 'These numbers are for this list only. When your medicines change, ask the clinic for a new card.',
    none: 'There are no medicines on your list yet. When there are, ask the clinic for a new card.',
  },
  answer: {
    title: 'The day’s question',
    how: 'Q, then your answer in your own words.',
    example: 'walked after dinner',
  },
  exampleTitle: 'One message can look like this',
  noReply: 'The clinic does not reply to these messages. Your doctor sees them at your next visit.',
  notAdvice: 'This is not for emergencies. If you feel unwell, contact your clinic or a doctor.',
  owner: 'Card for {name}, {reg}',
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}

export type CardStrings = typeof en

const hi: CardStrings = {
  langName: 'हिन्दी',
  title: 'अपनी डायरी SMS से भेजिए',
  sendTo: 'अपने संदेश इस नंबर पर भेजिए',
  from: 'संदेश उसी फ़ोन से भेजिए जिसका नंबर {last4} पर ख़त्म होता है। दूसरे फ़ोन से भेजे संदेश नहीं पढ़े जाते।',
  howTo: 'हर बात अलग लाइन में लिखिए। एक संदेश में कई लाइनें भेज सकते हैं। अंग्रेज़ी के बड़े या छोटे अक्षर, दोनों चलेंगे।',
  reading: {
    title: 'शुगर की रीडिंग',
    how: 'G, फिर मीटर पर दिखा नंबर, फिर एक अक्षर कि रीडिंग कब ली।',
    example: '142 सिर्फ़ एक उदाहरण है। अपने मीटर पर दिखा नंबर भेजिए।',
    when: {
      F: 'नाश्ते से पहले',
      B: 'खाने से पहले',
      A: 'खाने के बाद',
      N: 'सोने से पहले',
      O: 'रात में',
      R: 'किसी और समय',
    },
    needLetter: 'इनमें से कोई अक्षर न हो तो रीडिंग सहेजी नहीं जाती।',
  },
  medicine: {
    title: 'दवा',
    how: 'T, फिर नीचे दिया दवा का नंबर, फिर Y अगर दवा ले ली, या N अगर नहीं ली।',
    list: 'आपकी दवाइयाँ, {date} की सूची से',
    change: 'ये नंबर सिर्फ़ इसी सूची के हैं। दवाइयाँ बदलें तो क्लिनिक से नया कार्ड लीजिए।',
    none: 'आपकी सूची में अभी कोई दवा नहीं है। दवाइयाँ जुड़ें तो क्लिनिक से नया कार्ड लीजिए।',
  },
  answer: {
    title: 'दिन का सवाल',
    how: 'Q, फिर अपने शब्दों में जवाब।',
    example: 'खाने के बाद टहला',
  },
  exampleTitle: 'एक संदेश ऐसा दिख सकता है',
  noReply: 'क्लिनिक इन संदेशों का जवाब नहीं देता। आपके डॉक्टर इन्हें अगली मुलाक़ात पर देखते हैं।',
  notAdvice: 'यह आपात स्थिति के लिए नहीं है। तबीयत ठीक न लगे तो अपने क्लिनिक या किसी डॉक्टर से संपर्क करें।',
  owner: '{name}, {reg} का कार्ड',
  months: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
}

const ur: CardStrings = {
  langName: 'اردو',
  title: 'اپنی ڈائری SMS سے بھیجیں',
  sendTo: 'اپنے پیغام اس نمبر پر بھیجیں',
  from: 'پیغام اسی فون سے بھیجیں جس کا نمبر {last4} پر ختم ہوتا ہے۔ دوسرے فون سے بھیجے گئے پیغام نہیں پڑھے جاتے۔',
  howTo: 'ہر بات الگ لائن میں لکھیں۔ ایک پیغام میں کئی لائنیں بھیج سکتے ہیں۔ انگریزی کے بڑے یا چھوٹے حروف، دونوں چلیں گے۔',
  reading: {
    title: 'شوگر کی ریڈنگ',
    how: 'G، پھر میٹر پر دکھایا گیا نمبر، پھر ایک حرف کہ ریڈنگ کب لی۔',
    example: '142 صرف ایک مثال ہے۔ اپنے میٹر پر دکھایا گیا نمبر بھیجیں۔',
    when: {
      F: 'ناشتے سے پہلے',
      B: 'کھانے سے پہلے',
      A: 'کھانے کے بعد',
      N: 'سونے سے پہلے',
      O: 'رات میں',
      R: 'کسی اور وقت',
    },
    needLetter: 'ان میں سے کوئی حرف نہ ہو تو ریڈنگ محفوظ نہیں ہوتی۔',
  },
  medicine: {
    title: 'دوا',
    how: 'T، پھر نیچے دیا گیا دوا کا نمبر، پھر Y اگر دوا لے لی، یا N اگر نہیں لی۔',
    list: 'آپ کی دوائیں، {date} کی فہرست سے',
    change: 'یہ نمبر صرف اسی فہرست کے ہیں۔ دوائیں بدلیں تو کلینک سے نیا کارڈ لیں۔',
    none: 'آپ کی فہرست میں ابھی کوئی دوا نہیں ہے۔ دوائیں شامل ہوں تو کلینک سے نیا کارڈ لیں۔',
  },
  answer: {
    title: 'دن کا سوال',
    how: 'Q، پھر اپنے الفاظ میں جواب۔',
    example: 'کھانے کے بعد چہل قدمی کی',
  },
  exampleTitle: 'ایک پیغام ایسا دکھ سکتا ہے',
  noReply: 'کلینک ان پیغامات کا جواب نہیں دیتا۔ آپ کے ڈاکٹر انہیں اگلی ملاقات پر دیکھتے ہیں۔',
  notAdvice: 'یہ ہنگامی حالت کے لیے نہیں ہے۔ طبیعت ٹھیک نہ لگے تو اپنے کلینک یا کسی ڈاکٹر سے رابطہ کریں۔',
  owner: '{name}، {reg} کا کارڈ',
  months: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],
}

export const CARD: Record<CardLang, CardStrings> = { en, hi, ur }

/* A date the way the patient app writes one: the day, then the month in words. */
export function cardDate(iso: string, s: CardStrings): string {
  const d = new Date(iso)
  return `${d.getDate()} ${s.months[d.getMonth()]} ${d.getFullYear()}`
}
