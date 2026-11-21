import { createContext, useContext } from "react";

export const LanguageContext = createContext({ language: "en", toggleLanguage: () => {} });

export function useLanguage() {
  return useContext(LanguageContext);
}

const labels = {
  en: {
    overview: "Overview", generator: "AI Video Generator", library: "Media Library", voice: "Khmer AI Voice", recap: "Chinese Story Recap", publisher: "Auto Publisher", analytics: "Analytics", settings: "Settings", signOut: "Sign out", workspace: "Personal workspace", phase1: "Phase 1 · Local storage", language: "ខ្មែរ", home: "Home", admin: "Admin", back: "Back to overview", recapTitle: "Turn a Chinese story into a Khmer recap.", recapDescription: "Paste Chinese subtitles or a transcript, let Gemini shape the story, then generate a narrated MP4 from your authorized source video.", generateRecap: "Generate recap", generateVoice: "Generate timeline voice", exportVideo: "Export Video", sourceText: "Paste Chinese subtitles", recapScript: "Review before voice generation", selectedVoice: "SELECTED VOICE", timelineSummary: "Timeline Summary", generatedAudio: "Generated Audio", videoPreview: "VIDEO PREVIEW", output: "Output", ready: "READY", chooseMp4: "Choose MP4", sourceReady: "Source video ready", chooseSource: "Choose an MP4 source", subtitleHint: "Paste Chinese subtitles or story text…", scriptHint: "Your generated recap will appear here. You can edit it before creating narration.", outputKhmer: "Khmer", outputEnglish: "English"
  },
  km: {
    overview: "ទំព័រដើម", generator: "បង្កើតវីដេអូ AI", library: "បណ្ណាល័យមេឌៀ", voice: "សំឡេង AI ខ្មែរ", recap: "សម្រាយរឿងចិន", publisher: "បោះផ្សាយដោយស្វ័យប្រវត្តិ", analytics: "ស្ថិតិ", settings: "ការកំណត់", signOut: "ចាកចេញ", workspace: "កន្លែងធ្វើការផ្ទាល់ខ្លួន", phase1: "ដំណាក់កាល ១ · រក្សាទុកក្នុងម៉ាស៊ីន", language: "English", home: "ទំព័រដើម", admin: "អ្នកគ្រប់គ្រង", back: "ត្រឡប់ទៅទំព័រដើម", recapTitle: "បំលែងរឿងចិនទៅជាសម្រាយជាភាសាខ្មែរ", recapDescription: "បញ្ចូលអក្សររឿងចិន ឲ្យ Gemini រៀបចំសាច់រឿង ហើយបង្កើត MP4 មានសំឡេងពីវីដេអូដែលអ្នកមានសិទ្ធិប្រើ។", generateRecap: "បង្កើតសម្រាយរឿង", generateVoice: "បង្កើតសំឡេងតាម Timeline", exportVideo: "នាំចេញវីដេអូ", sourceText: "បញ្ចូលអក្សររឿងចិន", recapScript: "ពិនិត្យមុនបង្កើតសំឡេង", selectedVoice: "សំឡេងដែលបានជ្រើស", timelineSummary: "សង្ខេប Timeline", generatedAudio: "សំឡេងដែលបានបង្កើត", videoPreview: "មើលវីដេអូជាមុន", output: "ភាសាលទ្ធផល", ready: "រួចរាល់", chooseMp4: "ជ្រើស MP4", sourceReady: "វីដេអូប្រភពរួចរាល់", chooseSource: "ជ្រើសវីដេអូ MP4", subtitleHint: "បញ្ចូលអក្សររឿងចិន ឬអត្ថបទសម្រាយ…", scriptHint: "សម្រាយដែលបានបង្កើតនឹងបង្ហាញនៅទីនេះ។ អ្នកអាចកែសម្រួលមុនបង្កើតសំឡេង។", outputKhmer: "ខ្មែរ", outputEnglish: "អង់គ្លេស"
  }
};

export function text(language, key, fallback = key) {
  return labels[language]?.[key] || labels.en[key] || fallback;
}
