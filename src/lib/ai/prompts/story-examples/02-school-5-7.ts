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
      "Yusuf walking confidently into a school hallway, his name written on the back of his small hand, morning sun streaming in",
    parentDiscussionQuestion:
      "لو إنت اتهت في مكان ما، هتفكر إزاي عشان تلاقي طريقك؟",
    moralStatement:
      "وعرف يوسف إن الشجاعة مش غياب الخوف — الشجاعة إنك تخطّي خطوة لقدام حتى لو قلبك بيرتجف.",
    pages: [
      {
        number: 1,
        act: "setup",
        emotionalBeat: "anticipation mixed with anxiety",
        moralMoment: false,
        charactersOnPage: ["Yusuf", "Mama"],
        keyObjectOrDetail: "blue ballpoint pen writing on Yusuf's small palm",
        text: "صبح أول يوم مدرسة، ماما كَتَبَت اسم يُوسُف على إيده الصغيرة، عشان لو احتاج. قالت له: «إنت بَطَل وعاقل، وأبلتك اسمها أبلة مُنَى. متنساش.» يُوسُف هَزِّ راسه، ولكن قلبه كان بيدق بسرعة. الزي الجديد كان لسه فيه ريحة الأقمشة.",
        scene:
          "Mother holding Yusuf's small hand writing his name on it with a pen at the kitchen counter — tender pre-school moment",
      },
      {
        number: 2,
        act: "setup",
        emotionalBeat: "disorientation, isolation",
        moralMoment: false,
        charactersOnPage: ["Yusuf"],
        keyObjectOrDetail: "small school satchel slung over Yusuf's shoulder",
        text: "في ساحة المدرسة، الأطفال كانوا متجمعين بصفوف. الجرس دق فَجْأة، وكل واحد جِري ناحية فصله. يُوسُف وقف لحظة في النص، الصفوف اتْحَرَّكَت كلها مرة واحدة، وفَجْأة لقى نفسه واقف لِوَحْده في ساحة فاضية. مكانش فاكر فصله فين.",
        scene:
          "Yusuf standing alone in the middle of an empty school courtyard right after the bell rings, students disappearing into classrooms",
      },
      {
        number: 3,
        act: "challenge",
        emotionalBeat: "first attempt — ignored",
        moralMoment: false,
        charactersOnPage: ["Yusuf", "Older boy"],
        keyObjectOrDetail: "older boy's heavy backpack swinging as he hurries away",
        text: "ولد أكبر منه كان ماشي بسرعة. يُوسُف اتْكَلِّم: «أستاذ، فين فصل أبلة مُنَى؟» الولد ما سمعش، ولا حتى وقف. اخْتَفَى ورا ركن المدرسة. يُوسُف لقى نفسه لسه واقف لِوَحْده، والصمت كبير حواليه.",
        scene:
          "Yusuf reaching out to ask an older boy hurrying past, the older boy already moving away unanswered",
      },
      {
        number: 4,
        act: "challenge",
        emotionalBeat: "second attempt — wrong path",
        moralMoment: false,
        charactersOnPage: ["Yusuf", "Wrong-classroom teacher"],
        keyObjectOrDetail: "wrong classroom doorway with a kindergarten alphabet poster on the wall",
        text: "شاف مجموعة بنات داخلين فصل قريب. قال في نفسه: «أكيد دي الفصول الصغيرة.» لِحْقهم وفات معاهم من الباب. لكن أبلة الفصل ابْتَسَمَت وقالت: «يا حبيبي، إنت من الصف الكبير. ده فصلنا إحنا.» يُوسُف خرج بسرعة، وخدوده اتْوَرِّدوا.",
        scene:
          "Yusuf walking shyly out of the wrong classroom doorway, a kindly teacher gently redirecting him, other children looking on",
      },
      {
        number: 5,
        act: "challenge",
        emotionalBeat: "the dark moment turns into clever insight",
        moralMoment: false,
        charactersOnPage: ["Yusuf"],
        keyObjectOrDetail: "row of small wooden classroom name plaques above doorways",
        text: "وقف يُوسُف لحظة، أخد نفس عميق. افْتَكَر كلام ماما: «إنت بطل وعاقل.» وفَكَّر: «لو فاكر اسم أبلتي، يبقى لازم لاقي اسمها.» بَصَّ حواليه، ولاحظ إن كل فصل عليه لافتة بإسم الأبلة.",
        scene:
          "Yusuf pausing in the school hallway, thoughtful expression, looking up at the classroom name signs above the doors",
      },
      {
        number: 6,
        act: "resolution",
        emotionalBeat: "courageous action solving the problem",
        moralMoment: true,
        charactersOnPage: ["Yusuf", "Teacher Mona"],
        keyObjectOrDetail: "wooden classroom door with 'أبلة مُنَى' name plaque above it",
        text: "مِشِي بِبُطْء في الممر، بيقرا اللافتات الواحدة ورا التانية. «أبلة سُعاد… أبلة هِنْد… أبلة مُنَى!» وقف. كان قلبه بيقول: ادخل! فتح الباب بإيد مُتَوَتِّرة شوية. أبلة مُنَى ابْتَسَمَت وقالت: «أهلاً يا يُوسُف. كنا مستنينك.»",
        scene:
          "Yusuf opening a classroom door with hopeful determined expression, the teacher smiling and welcoming him from inside",
      },
      {
        number: 7,
        act: "resolution",
        emotionalBeat: "belonging — the reward of courage",
        moralMoment: false,
        charactersOnPage: ["Yusuf", "Farida", "Teacher Mona"],
        keyObjectOrDetail: "wooden classroom desk with a fresh notebook on top",
        text: "قعد يُوسُف في كرسي فاضي جنب بنت اسمها فَرِيدة. ابْتَسَمَت له. الفصل كان مليان أسماء جديدة، وألوان حلوة على الحيطة. أبلة مُنَى بدأت تقرا اسماء التلاميذ. لما قالت «يُوسُف!» رَدِّ بصوت قوي: «حاضر يا أبلة!»",
        scene:
          "Yusuf sitting at a classroom desk next to a smiling girl, teacher reading attendance from the front of the room",
      },
      {
        number: 8,
        act: "resolution",
        emotionalBeat: "earned pride, growth",
        moralMoment: false,
        charactersOnPage: ["Yusuf", "Mama"],
        keyObjectOrDetail: "Yusuf's school satchel dropped at the apartment doorway",
        text: "آخر اليوم، يُوسُف رجع البيت، وحس إنه أكبر من الصبح بعشر سنين. ماما قابلته وسألت: «حصل إيه يا حبيبي؟» ضِحِك وقال: «تُهْت، بس لقيت طريقي لِوَحْدي.»",
        scene:
          "Yusuf hugging his mother proudly at home after school, tired but satisfied expression",
      },
    ],
  },
} as const;
