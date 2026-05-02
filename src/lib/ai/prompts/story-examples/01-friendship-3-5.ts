// Few-shot example #1 — Friendship + Kindness, age band 3-5.
// Target: ~25-35 words per page.
//
// Plot upgrade (sessions 9.6 + 9.7): real challenge with character agency
// (Layla gives up her favorite toy to break Nour's shyness). Three-act
// structure (setup → challenge → resolution). Per-page act + emotionalBeat
// + moralMoment metadata. Cover description + parent discussion question
// adopted from HekayaAI prompt review.

export const FRIENDSHIP_KINDNESS_3_5 = {
  context: {
    childName: "ليلى",
    childAgeBand: "3-5",
    childAgeExact: 4,
    childGender: "girl",
    theme: "الصداقة",
    moralValue: "اللطف",
    customScene: null,
    specialOccasion: null,
    supportingCharacters: [],
  },

  story: {
    title: "لَيْلَى وَالدَلْو الصغير",
    dedication: "إلى لَيْلَى — أحلى حاجة تَعْطِيها هي اللي بتغلى عَلَيكي",
    coverDescription:
      "Egyptian girl ~4 years old, dark curly hair, in a Cairo park, standing with another small girl, both holding a small red sand bucket between them, watercolor warm sunset light, simple iconic friendship scene with cream and terracotta tones",
    parentDiscussionQuestion:
      "في حاجة بتحبيها أوي عندك؟ لو لقيتي صاحبة محتاجاها، هتعمل إيه؟",
    pages: [
      {
        number: 1,
        act: "setup",
        emotionalBeat: "joy and possession",
        moralMoment: false,
        text: "كان عند لَيْلَى دَلْو صغير لونه أحمر، أحلى لعبة عندها. بتاخده معاها كل يوم في الحديقة، وبتعمل بيه قِلَاع من الرَمْل عالية.",
        illustrationPrompt:
          "Egyptian girl ~4 years old in a Cairo neighborhood park sandbox, holding a small red bucket happily, watercolor warm afternoon light, sense of cherished possession",
      },
      {
        number: 2,
        act: "setup",
        emotionalBeat: "noticing another's loneliness",
        moralMoment: false,
        text: "في يوم، شافت لَيْلَى بنت صغيرة جديدة قاعدة لِوَحْدها على الكرسي. إيديها فاضية، وعينيها بتبص على الأطفال اللي بيلعبوا.",
        illustrationPrompt:
          "Small girl in plain dress sitting alone on a wooden bench in Cairo park, empty hands, watching other children play, watercolor style with subtle melancholy tones",
      },
      {
        number: 3,
        act: "challenge",
        emotionalBeat: "first attempt — failed",
        moralMoment: false,
        text: "لَيْلَى لَوَّحَت لها بإيدها وقالت: «هَاي!» البنت بَصَّت لها وما رَدِّتش. لَيْلَى افْتَكَرَت إنها مَكْسُوفة.",
        illustrationPrompt:
          "Layla waving cheerfully from a distance, the new girl looking down shyly, watercolor style, Cairo park, gentle quiet moment",
      },
      {
        number: 4,
        act: "challenge",
        emotionalBeat: "second attempt — failed",
        moralMoment: false,
        text: "لَيْلَى جَابَت كرتها وقالت: «تعالي نِلعب!» البنت هَزِّت راسها. لَيْلَى افْتَكَرَت: «يمكن مش عاوزة كرة.»",
        illustrationPrompt:
          "Layla offering a ball to a shy girl on a bench, the girl gently shaking her head, watercolor style, soft afternoon light",
      },
      {
        number: 5,
        act: "challenge",
        emotionalBeat: "the inner choice (dark moment of decision)",
        moralMoment: false,
        text: "لَيْلَى بَصِّت على دلوها الأحمر. بَصِّت على إيدين البنت الفاضيين. وفَكَّرَت فِكْرة كبيرة في قلبها الصغير.",
        illustrationPrompt:
          "Close-up of Layla looking thoughtfully at her beloved red bucket, empathetic expression, watercolor style with soft contemplative mood",
      },
      {
        number: 6,
        act: "resolution",
        emotionalBeat: "act of generosity (moral demonstrated)",
        moralMoment: true,
        text: "مِشِيت ناحيتها وحَطِّت الدَلْو في إيدها. قالت بصوت لطيف: «ده ليكي دلوقتي. تعالي نبني سَوا.»",
        illustrationPrompt:
          "Layla placing her red bucket gently into the new girl's hands, both girls at eye level, watercolor warm tones, defining moment of generosity",
      },
      {
        number: 7,
        act: "resolution",
        emotionalBeat: "connection and reciprocity",
        moralMoment: false,
        text: "البنت ابْتَسَمَت لأول مرة. قالت: «أنا اسمي نُور.» وقامت تِجْري ورا لَيْلَى ناحية الرَمْلَة.",
        illustrationPrompt:
          "Two girls running together toward a sandbox, the new girl now smiling holding the red bucket, watercolor style with warm joyful motion",
      },
      {
        number: 8,
        act: "resolution",
        emotionalBeat: "internal warmth (show, not tell)",
        moralMoment: false,
        text: "بَنُوا قَلْعة كبيرة سَوا. الشمس كانت بتغيب، ولَيْلَى كانت حاسة بحاجة دافية في صدرها — أحلى من الدَلْو.",
        illustrationPrompt:
          "Two girls together at sunset finishing a large sand castle in Cairo park, golden hour orange and terracotta tones, watercolor style, sense of meaningful warmth",
      },
    ],
  },
} as const;
