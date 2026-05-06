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
      "Layla and Nour standing close together holding her small red sand bucket between them, both smiling, golden sunset light",
    parentDiscussionQuestion:
      "في حاجة بتحبيها أوي عندك؟ لو لقيتي صاحبة محتاجاها، هتعمل إيه؟",
    moralStatement:
      "وفي الآخر، عرفت ليلى إن أحلى حاجة تعطيها هي اللي بتغلى عليكي — وإن اللطف بيدفي القلب أكتر من أي لعبة.",
    pages: [
      {
        number: 1,
        act: "setup",
        emotionalBeat: "joy and possession",
        moralMoment: false,
        charactersOnPage: ["Layla"],
        keyObjectOrDetail: "small bright-red sand bucket with metal handle",
        text: "كان عند لَيْلَى دَلْو صغير لونه أحمر، أحلى لعبة عندها. بتاخده معاها كل يوم في الحديقة، وبتعمل بيه قِلَاع من الرَمْل عالية.",
        scene:
          "Layla in a sandbox holding her small red bucket happily, scooping sand with cherished pride",
      },
      {
        number: 2,
        act: "setup",
        emotionalBeat: "noticing another's loneliness",
        moralMoment: false,
        charactersOnPage: ["Layla", "Nour"],
        keyObjectOrDetail: "weathered wooden park bench under a tree",
        text: "في يوم، شافت لَيْلَى بنت صغيرة جديدة قاعدة لِوَحْدها على الكرسي. إيديها فاضية، وعينيها بتبص على الأطفال اللي بيلعبوا.",
        scene:
          "A new small girl sits alone on a wooden bench, empty hands resting in lap, watching other children play",
      },
      {
        number: 3,
        act: "challenge",
        emotionalBeat: "first attempt — failed",
        moralMoment: false,
        charactersOnPage: ["Layla", "Nour"],
        keyObjectOrDetail: "Layla's red bucket still in her left hand",
        text: "لَيْلَى لَوَّحَت لها بإيدها وقالت: «هَاي!» البنت بَصَّت لها وما رَدِّتش. لَيْلَى افْتَكَرَت إنها مَكْسُوفة.",
        scene:
          "Layla waves cheerfully from a few steps away, the new girl looking down at her own hands shyly",
      },
      {
        number: 4,
        act: "challenge",
        emotionalBeat: "second attempt — failed",
        moralMoment: false,
        charactersOnPage: ["Layla", "Nour"],
        keyObjectOrDetail: "colorful striped rubber ball Layla offers",
        text: "لَيْلَى جَابَت كرتها وقالت: «تعالي نِلعب!» البنت هَزِّت راسها. لَيْلَى افْتَكَرَت: «يمكن مش عاوزة كرة.»",
        scene:
          "Layla holds out a colorful ball with bright eyes, the shy girl gently shakes her head no",
      },
      {
        number: 5,
        act: "challenge",
        emotionalBeat: "the inner choice (dark moment of decision)",
        moralMoment: false,
        charactersOnPage: ["Layla"],
        keyObjectOrDetail: "small red sand bucket cradled in Layla's hands",
        text: "لَيْلَى بَصِّت على دلوها الأحمر. بَصِّت على إيدين البنت الفاضيين. وفَكَّرَت فِكْرة كبيرة في قلبها الصغير.",
        scene:
          "Close-up of Layla looking thoughtfully at her beloved red bucket cradled in her hands, contemplative expression",
      },
      {
        number: 6,
        act: "resolution",
        emotionalBeat: "act of generosity (moral demonstrated)",
        moralMoment: true,
        charactersOnPage: ["Layla", "Nour"],
        keyObjectOrDetail: "small red sand bucket passing from Layla's hands to Nour's",
        text: "مِشِيت ناحيتها وحَطِّت الدَلْو في إيدها. قالت بصوت لطيف: «ده ليكي دلوقتي. تعالي نبني سَوا.»",
        scene:
          "Layla places her red bucket gently into the new girl's hands, both girls at eye level — defining moment",
      },
      {
        number: 7,
        act: "resolution",
        emotionalBeat: "connection and reciprocity",
        moralMoment: false,
        charactersOnPage: ["Layla", "Nour"],
        keyObjectOrDetail: "small red sand bucket now held by Nour",
        text: "البنت ابْتَسَمَت لأول مرة. قالت: «أنا اسمي نُور.» وقامت تِجْري ورا لَيْلَى ناحية الرَمْلَة.",
        scene:
          "The two girls running side by side toward the sandbox, Nour now smiling and holding the red bucket",
      },
      {
        number: 8,
        act: "resolution",
        emotionalBeat: "internal warmth (show, not tell)",
        moralMoment: false,
        charactersOnPage: ["Layla", "Nour"],
        keyObjectOrDetail: "tall sand castle with three turrets they built together",
        text: "بَنُوا قَلْعة كبيرة سَوا. الشمس كانت بتغيب، ولَيْلَى كانت حاسة بحاجة دافية في صدرها — أحلى من الدَلْو.",
        scene:
          "The two girls together at sunset finishing a large sand castle, faces lit by golden hour light",
      },
    ],
  },
} as const;
