// Few-shot example #2 — First day at school + Courage, age band 5-7.
// Target: ~50-70 words per page.
//
// Plot upgrade (sessions 9.6 + 9.7): Yusuf gets lost after the bell, has
// to figure out his classroom himself. Three try/fail beats: asks busy
// older boy → follows wrong group → uses cleverness to read class signs.
// Courage = persistence + smart problem-solving under fear.
// Per-page act + emotionalBeat + moralMoment metadata + cover description
// + parent discussion question.

export const SCHOOL_COURAGE_5_7 = {
  context: {
    childName: "يوسف",
    childAgeBand: "5-7",
    childAgeExact: 6,
    childGender: "boy",
    theme: "أول يوم في المدرسة",
    moralValue: "الشجاعة",
    customScene: null,
    specialOccasion: null,
    supportingCharacters: [],
  },

  story: {
    title: "يُوسُف وضَيَاع الفصل",
    dedication: "إلى يُوسُف — العقل الصغير لما يفكر، بيلاقي كل الطُرُق",
    coverDescription:
      "Egyptian boy ~6 years old in school uniform, walking confidently into a Cairo school hallway, his name written on the back of his hand, watercolor warm morning light, sense of bravery earned through small courage",
    parentDiscussionQuestion:
      "لو إنت اتهت في مكان ما، هتفكر إزاي عشان تلاقي طريقك؟",
    pages: [
      {
        number: 1,
        act: "setup",
        emotionalBeat: "anticipation mixed with anxiety",
        moralMoment: false,
        text: "صبح أول يوم مدرسة، ماما كَتَبَت اسم يُوسُف على إيده الصغيرة، عشان لو احتاج. قالت له: «إنت بَطَل وعاقل، وأبلتك اسمها أبلة مُنَى. متنساش.» يُوسُف هَزِّ راسه، ولكن قلبه كان بيدق بسرعة. الزي الجديد كان لسه فيه ريحة الأقمشة.",
        illustrationPrompt:
          "Egyptian mother writing her son's name on his small hand with a pen, both in modern Cairo apartment kitchen morning light, watercolor warm tones, tender pre-school moment",
      },
      {
        number: 2,
        act: "setup",
        emotionalBeat: "disorientation, isolation",
        moralMoment: false,
        text: "في ساحة المدرسة، الأطفال كانوا متجمعين بصفوف. الجرس دق فَجْأة، وكل واحد جِري ناحية فصله. يُوسُف وقف لحظة في النص، الصفوف اتْحَرَّكَت كلها مرة واحدة، وفَجْأة لقى نفسه واقف لِوَحْده في ساحة فاضية. مكانش فاكر فصله فين.",
        illustrationPrompt:
          "Egyptian school courtyard right after the bell rings, students rushing to classrooms, one small boy standing alone in the middle looking lost, watercolor style with sense of overwhelming moment",
      },
      {
        number: 3,
        act: "challenge",
        emotionalBeat: "first attempt — ignored",
        moralMoment: false,
        text: "ولد أكبر منه كان ماشي بسرعة. يُوسُف اتْكَلِّم: «أستاذ، فين فصل أبلة مُنَى؟» الولد ما سمعش، ولا حتى وقف. اخْتَفَى ورا ركن المدرسة. يُوسُف لقى نفسه لسه واقف لِوَحْده، والصمت كبير حواليه.",
        illustrationPrompt:
          "Small boy reaching out to ask an older boy hurrying past in school courtyard, the older boy already moving away, watercolor style, sense of being overlooked",
      },
      {
        number: 4,
        act: "challenge",
        emotionalBeat: "second attempt — wrong path",
        moralMoment: false,
        text: "شاف مجموعة بنات داخلين فصل قريب. قال في نفسه: «أكيد دي الفصول الصغيرة.» لِحْقهم وفات معاهم من الباب. لكن أبلة الفصل ابْتَسَمَت وقالت: «يا حبيبي، إنت من الصف الكبير. ده فصلنا إحنا.» يُوسُف خرج بسرعة، وخدوده اتْوَرِّدوا.",
        illustrationPrompt:
          "Boy walking shyly out of a wrong classroom while a kindly teacher gently redirects him, other children looking, watercolor style, embarrassment but also gentleness",
      },
      {
        number: 5,
        act: "challenge",
        emotionalBeat: "the dark moment turns into clever insight",
        moralMoment: false,
        text: "وقف يُوسُف لحظة، أخد نفس عميق. افْتَكَر كلام ماما: «إنت بطل وعاقل.» وفَكَّر: «لو فاكر اسم أبلتي، يبقى لازم لاقي اسمها.» بَصَّ حواليه، ولاحظ إن كل فصل عليه لافتة بإسم الأبلة.",
        illustrationPrompt:
          "Small boy pausing in school hallway, thoughtful expression, looking up at classroom signs above the doors, watercolor style with light bulb moment of cleverness",
      },
      {
        number: 6,
        act: "resolution",
        emotionalBeat: "courageous action solving the problem",
        moralMoment: true,
        text: "مِشِي بِبُطْء في الممر، بيقرا اللافتات الواحدة ورا التانية. «أبلة سُعاد… أبلة هِنْد… أبلة مُنَى!» وقف. كان قلبه بيقول: ادخل! فتح الباب بإيد مُتَوَتِّرة شوية. أبلة مُنَى ابْتَسَمَت وقالت: «أهلاً يا يُوسُف. كنا مستنينك.»",
        illustrationPrompt:
          "Boy proudly opening a classroom door with a hopeful expression, friendly teacher smiling and welcoming him from inside, watercolor warm light, moment of resolution",
      },
      {
        number: 7,
        act: "resolution",
        emotionalBeat: "belonging — the reward of courage",
        moralMoment: false,
        text: "قعد يُوسُف في كرسي فاضي جنب بنت اسمها فَرِيدة. ابْتَسَمَت له. الفصل كان مليان أسماء جديدة، وألوان حلوة على الحيطة. أبلة مُنَى بدأت تقرا اسماء التلاميذ. لما قالت «يُوسُف!» رَدِّ بصوت قوي: «حاضر يا أبلة!»",
        illustrationPrompt:
          "Boy sitting at his desk next to another student in a bright Egyptian classroom, both smiling at each other, teacher reading attendance from front, watercolor style colorful classroom",
      },
      {
        number: 8,
        act: "resolution",
        emotionalBeat: "earned pride, growth",
        moralMoment: false,
        text: "آخر اليوم، يُوسُف رجع البيت، وحس إنه أكبر من الصبح بعشر سنين. ماما قابلته وسألت: «حصل إيه يا حبيبي؟» ضِحِك وقال: «تُهْت، بس لقيت طريقي لِوَحْدي.»",
        illustrationPrompt:
          "Boy proudly hugging his mother at home after school, tired but satisfied expression, Cairo apartment afternoon light, watercolor style, sense of earned confidence",
      },
    ],
  },
} as const;
