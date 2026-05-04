// Few-shot example #3 — Eid + Generosity, age band 6-8.
// Target: ~75-95 words per page, longer sentences, emotional nuance.
//
// Plot upgrade (sessions 9.6 + 9.7): the deeper question of generosity.
// Maryam tries (and her offers fail) twice — money and food refused
// because Suad has pride. The third try works because real generosity =
// making someone feel equal and included, not transactional charity.
// Per-page act + emotionalBeat + moralMoment metadata + cover description
// + parent discussion question.

export const EID_GENEROSITY_6_8 = {
  context: {
    childName: "مريم",
    childAgeBand: "6-8",
    childAgeExact: 7,
    childGender: "girl",
    theme: "العيد",
    moralValue: "الكرم",
    customScene: null,
    specialOccasion: "أول عيد لمريم وهي بتساعد ماما في تجهيز السفرة",
    supportingCharacters: [],
  },

  story: {
    title: "مَرْيَم وَالكَحْك المتقاسم",
    dedication: "إلى مَرْيَم — قلبك الكبير هو أحلى عيد",
    coverDescription:
      "Maryam and Suad standing together holding a tray of kahk between them in an apartment hallway, both smiling proudly",
    parentDiscussionQuestion:
      "لو حد جنبك مش بيحس بفرحة العيد زيك، إيه أحلى طريقة تشاركه فرحتك؟",
    moralStatement:
      "وفي الآخر، عرفت مريم إن الكرم الحقيقي مش إنك تدّي، الكرم إنك تشوف اللي قدامك بقلبك وتشاركه الفرحة من غير ما تحسسه إنه محتاج.",
    pages: [
      {
        number: 1,
        act: "setup",
        emotionalBeat: "festive joy and family belonging",
        moralMoment: false,
        text: "في صباح أول يوم من العيد، صَحْيَت مَرْيَم على ريحة الكَحْك السخن وأصوات ضحك العيلة في الصالة. لبست فستانها الأخضر الجديد، ونزلت على المطبخ تلاقي ماما والست أم محمد، الجارة، بيلفّوا آخر صنية كَحْك. عيدية مَرْيَم كانت مبسوطاها فيها ورقة جديدة، حطّتها في جيبها. النهارده يوم خاص — أول مرة هتساعد ماما تستقبل ضيوف العيد.",
        scene:
          "Maryam in the kitchen on Eid morning, mother and neighbor woman rolling kahk dough on the counter beside her",
      },
      {
        number: 2,
        act: "setup",
        emotionalBeat: "noticing inequality at the festival",
        moralMoment: false,
        text: "بعد الفطار، نزلت مَرْيَم تحت العمارة عشان تشوف جيرانها وتعيّد عليهم. الشارع كان لابس العيد كله — بالونات على الشبابيك، وأطفال بفساتين جدد. مَرْيَم لمحت سُعاد، البنت اللي ساكنة في الدور الأرضي. سُعاد كانت لابسة فستانها العادي، واقفة بعيد، ومش بتلعب مع حد. مَرْيَم عرفت إن أهل سُعاد لسه ما عرفوش يحتفلوا بعيد كبير.",
        scene:
          "Apartment street on Eid morning, children in bright clothes celebrating, one small girl in plain dress standing alone watching from a distance",
      },
      {
        number: 3,
        act: "challenge",
        emotionalBeat: "first attempt — pride refuses charity",
        moralMoment: false,
        text: "مَرْيَم قَرَّبَت من سُعاد بحماس، وحَطِّت إيدها في جيبها. طَلَّعَت نص العيدية وقالت: «عيد سعيد يا سُعاد! دي ليكي.» سُعاد بَصِّت على الفلوس، ووشها اتْوَرَّد. حَطِّت إيديها ورا ضهرها وقالت بهدوء: «لأ يا مَرْيَم، شكراً. ماما قالتلي ما آخدش حاجة من حد.» مَرْيَم رَجَّعَت الفلوس على جيبها وحست بنوع غريب من الحرج.",
        scene:
          "Maryam offering money with bright eyes, Suad gently refusing with hands behind her back — neither shame nor hurt",
      },
      {
        number: 4,
        act: "challenge",
        emotionalBeat: "second attempt — kindness misunderstood",
        moralMoment: false,
        text: "مَرْيَم فَكَّرَت لحظة. مش هي اللي محتاجة فلوس. رَكَضَت ع البيت، ولَفِّت قطعة كَحْك في منديل. رجعت وقالت: «إيه رأيك تجربي كَحْك ماما؟ بتعمله أحلى من اللي في السوق.» سُعاد ابْتَسَمَت ابتسامة صغيرة، بس برضه قالت: «متشكرة، بس أنا فطرت.» مَرْيَم لَفِّت الكَحْك تاني، وقعدت جنبها على درجة العمارة. كانت في حاجة في عينين سُعاد — مش جوع، حاجة تانية.",
        scene:
          "The two girls sitting together on the apartment building steps, Maryam holding a small wrapped piece of kahk, Suad politely declining",
      },
      {
        number: 5,
        act: "challenge",
        emotionalBeat: "the deeper realization (dark moment)",
        moralMoment: false,
        text: "مَرْيَم سألت بصوت هاديء: «إنتي ما بتحبيش العيد؟» سُعاد بَصِّت على الأرض. قالت: «أنا بحب العيد، بس مش بنعمل في بيتنا حاجات كده. ماما بتشتغل، وبابا تعبان. مش زيكم.» مَرْيَم سَكَتَت. لأول مرة، فهمت إن العيد مش بس فلوس وكَحْك. سُعاد كانت محتاجة حاجة أكبر من الحاجتين دول.",
        scene:
          "Close-up of the two girls on apartment steps, Suad looking down quietly, Maryam listening with empathetic understanding",
      },
      {
        number: 6,
        act: "resolution",
        emotionalBeat: "creative generosity — inclusion not charity",
        moralMoment: true,
        text: "فِكْرة خَطَرَت لمَرْيَم زي شُعاع. قامت وأخدت إيد سُعاد. «تعالي معايا.» سُعاد سَحَبَت إيدها: «لأ، أنا ما عرفش...» مَرْيَم ابْتَسَمَت: «مش لتاخدي حاجة. عشان تساعديني. ماما بتعمل صنية كَحْك تانية، ومحتاجة إيدين شاطرة. إنتي شاطرة، صح؟» سُعاد بَصِّت لها بِنَوْع من الدهشة، وفي الأخير هَزِّت راسها.",
        scene:
          "Maryam pulling Suad by the hand toward the apartment door, gentle insistence — Suad looking surprised but tempted",
      },
      {
        number: 7,
        act: "resolution",
        emotionalBeat: "joyful belonging through co-creation",
        moralMoment: false,
        text: "في المطبخ، ماما رَحَّبَت بسُعاد كأنها بنتها. الست أم محمد ضِحْكَت: «يلا يا حبيبتي، علّميني أنا إزاي بتلفي.» سُعاد بدأت بخجل، بس بعد كم دقيقة، إيديها كانت بتشتغل بسرعة وبفرح. ضِحْكَت لأول مرة. مَرْيَم اتْفَرَّجَت عليها، وحست إن قلبها بقى أكبر من فستانها الجديد. الكَحْك اللي عملوه كان شكله مش متساوي، بس كان أحلى كَحْك في الدنيا.",
        scene:
          "Three women and two girls all rolling kahk together at the flour-covered kitchen counter, Suad now smiling and laughing",
      },
      {
        number: 8,
        act: "resolution",
        emotionalBeat: "dignity and friendship",
        moralMoment: false,
        text: "آخر اليوم، سُعاد طلعت من البيت ماسكة صنية كَحْك في إيدها — الكَحْك اللي عملته بإيديها. قالت لمَرْيَم: «هاخد ده لماما وبابا.» مَرْيَم حَضَنَتها. لما رجعت لماما، حَكَت لها كل حاجة. ماما قالت بهدوء: «الكَرَم الحقيقي مش إنك تدّي حاجة. الكَرَم إنك تخلي حد يحس إنه عُضْو في الفرحة.»",
        scene:
          "Suad walking proudly down apartment stairs holding a tray of kahk she made, Maryam waving from a doorway above",
      },
    ],
  },
} as const;
