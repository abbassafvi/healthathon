import type { Strings } from './en'

/*
 * DRAFT, NOT REVIEWED BY A SPEAKER. Do not use with patients or at the
 * demonstration until a Hindi speaker has reviewed every string. The
 * project requires translations made and reviewed by people.
 */
export const REVIEWED = false

export const hi: Strings = {
  langName: 'हिन्दी',
  welcome: {
    title: 'नमस्ते',
    body: 'हर दिन अपनी दवाइयों पर निशान लगाइए और शुगर की रीडिंग लिखिए। अगली बार डॉक्टर इन्हें देखेंगे।',
    chooseLanguage: 'अपनी भाषा चुनिए',
    choosePatient: 'यह फ़ोन कौन इस्तेमाल कर रहा है?',
    demo: 'डेमो: ये काल्पनिक मरीज़ हैं।',
    start: 'शुरू करें',
  },
  today: {
    greeting: 'नमस्ते, {name}',
    medicines: 'दवाइयाँ',
    medicinesHelp: 'हर दवा के लिए "ले ली" या "नहीं ली" दबाएँ।',
    noChecklist: 'आपके डॉक्टर ने अभी दवाइयों की सूची नहीं दी है।',
    ticked: 'ले ली',
    notTicked: 'अभी निशान नहीं',
    notTaken: 'नहीं ली',
    loadFailed: 'आज की जानकारी नहीं खुल सकी। इंटरनेट देखें।',
    retry: 'फिर से कोशिश करें',
    saveFailed: 'यह सहेजा नहीं गया। इंटरनेट देखकर फिर से कोशिश करें।',
    tickLabel: '{drug} {dose}, {schedule}. {state}',
    sugar: 'शुगर रीडिंग',
    addReading: 'रीडिंग जोड़ें',
    noReadings: 'आज कोई रीडिंग नहीं।',
    reading: '{value} mg/dL, {context}, {time}',
    question: 'आज का सवाल',
    answered: 'आपका जवाब: {answer}',
    changeAnswer: 'जवाब बदलें',
    yes: 'हाँ',
    no: 'नहीं',
    writeAnswer: 'अपना जवाब लिखिए',
    send: 'भेजें',
    meal: 'खाने की फ़ोटो',
    mealHelp: 'अपनी थाली की फ़ोटो लीजिए। यह जैसी है वैसी डॉक्टर तक जाएगी।',
    addMeal: 'खाने की फ़ोटो जोड़ें',
    mealsToday: 'आज {n} फ़ोटो',
    mealsTodayOne: 'आज 1 फ़ोटो',
    survey: 'इस हफ़्ते',
    surveyOpen: 'इस हफ़्ते के सवालों के जवाब दीजिए',
    surveyDone: 'धन्यवाद। इस हफ़्ते के जवाब भेज दिए गए।',
    switchUser: 'भाषा या व्यक्ति बदलें',
    savedNote: 'सहेजा गया',
  },
  glucose: {
    title: 'शुगर रीडिंग',
    value: 'मीटर की रीडिंग (mg/dL)',
    when: 'आपने यह कब ली?',
    contexts: {
      fasting: 'नाश्ते से पहले',
      before_meal: 'खाने से पहले',
      after_meal: 'खाने के बाद',
      bedtime: 'सोने से पहले',
      overnight: 'रात में',
      random: 'किसी और समय',
    },
    save: 'रीडिंग सहेजें',
    cancel: 'रद्द करें',
    needValue: 'मीटर का नंबर लिखिए।',
    needContext: 'चुनिए कि आपने यह कब ली।',
  },
  survey: { title: 'इस हफ़्ते', done: 'जवाब भेजें', back: 'वापस' },
  days: { short: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'] },
  months: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
}
