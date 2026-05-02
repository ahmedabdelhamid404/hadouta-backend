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
      "Egyptian girl ~7 years old in green Eid dress, holding a tray of homemade kahk with another girl in plain clothes beside her, both smiling proudly, Cairo apartment hallway with warm Eid morning light, watercolor warm tones with festive atmosphere",
    parentDiscussionQuestion:
      "لو حد جنبك مش بيحس بفرحة العيد زيك، إيه أحلى طريقة تشاركه فرحتك؟",
    pages: [
      {
        number: 1,
        act: "setup",
        emotionalBeat: "festive joy and family belonging",
        moralMoment: false,
        text: "في صباح أول يوم من العيد، صَحْيَت مَرْيَم على ريحة الكَحْك السخن وأصوات ضحك العيلة في الصالة. لبست فستانها الأخضر الجديد، ونزلت على المطبخ تلاقي ماما والست أم محمد، الجارة، بيلفّوا آخر صنية كَحْك. عيدية مَرْيَم كانت مبسوطاها فيها ورقة جديدة، حطّتها في جيبها. النهارده يوم خاص — أول مرة هتساعد ماما تستقبل ضيوف العيد.",
        illustrationPrompt:
          "Egyptian girl ~7 years old in green Eid dress in a modern Cairo apartment kitchen on Eid morning, mother and neighbor woman rolling kahk on the counter, sunlight, watercolor style with warm festive atmosphere",
      },
      {
        number: 2,
        act: "setup",
        emotionalBeat: "noticing inequality at the festival",
        moralMoment: false,
        text: "بعد الفطار، نزلت مَرْيَم تحت العمارة عشان تشوف جيرانها وتعيّد عليهم. الشارع كان لابس العيد كله — بالونات على الشبابيك، وأطفال بفساتين جدد. مَرْيَم لمحت سُعاد، البنت اللي ساكنة في الدور الأرضي. سُعاد كانت لابسة فستانها العادي، واقفة بعيد، ومش بتلعب مع حد. مَرْيَم عرفت إن أهل سُعاد لسه ما عرفوش يحتفلوا بعيد كبير.",
        illustrationPrompt:
          "Cairo apartment street on Eid morning, festive atmosphere with children in bright clothes, one small girl in plain dress standing alone watching from a distance, watercolor style with subtle social contrast",
      },
      {
        number: 3,
        act: "challenge",
        emotionalBeat: "first attempt — pride refuses charity",
        moralMoment: false,
        text: "مَرْيَم قَرَّبَت من سُعاد بحماس، وحَطِّت إيدها في جيبها. طَلَّعَت نص العيدية وقالت: «عيد سعيد يا سُعاد! دي ليكي.» سُعاد بَصِّت على الفلوس، ووشها اتْوَرَّد. حَطِّت إيديها ورا ضهرها وقالت بهدوء: «لأ يا مَرْيَم، شكراً. ماما قالتلي ما آخدش حاجة من حد.» مَرْيَم رَجَّعَت الفلوس على جيبها وحست بنوع غريب من الحرج.",
        illustrationPrompt:
          "Two girls on a Cairo street, one offering money with bright eyes, the other gently refusing with hands behind her back, watercolor style with quiet emotional nuance, neither shame nor hurt",
      },
      {
        number: 4,
        act: "challenge",
        emotionalBeat: "second attempt — kindness misunderstood",
        moralMoment: false,
        text: "مَرْيَم فَكَّرَت لحظة. مش هي اللي محتاجة فلوس. رَكَضَت ع البيت، ولَفِّت قطعة كَحْك في منديل. رجعت وقالت: «إيه رأيك تجربي كَحْك ماما؟ بتعمله أحلى من اللي في السوق.» سُعاد ابْتَسَمَت ابتسامة صغيرة، بس برضه قالت: «متشكرة، بس أنا فطرت.» مَرْيَم لَفِّت الكَحْك تاني، وقعدت جنبها على درجة العمارة. كانت في حاجة في عينين سُعاد — مش جوع، حاجة تانية.",
        illustrationPrompt:
          "Two girls sitting together on the steps of a Cairo apartment building, one holding a small wrapped piece of kahk, the other politely declining, watercolor style with warmth despite the rejection",
      },
      {
        number: 5,
        act: "challenge",
        emotionalBeat: "the deeper realization (dark moment)",
        moralMoment: false,
        text: "مَرْيَم سألت بصوت هاديء: «إنتي ما بتحبيش العيد؟» سُعاد بَصِّت على الأرض. قالت: «أنا بحب العيد، بس مش بنعمل في بيتنا حاجات كده. ماما بتشتغل، وبابا تعبان. مش زيكم.» مَرْيَم سَكَتَت. لأول مرة، فهمت إن العيد مش بس فلوس وكَحْك. سُعاد كانت محتاجة حاجة أكبر من الحاجتين دول.",
        illustrationPrompt:
          "Close-up of two girls on apartment steps, one looking down quietly, the other listening with empathy, watercolor style with deeply emotional understanding moment",
      },
      {
        number: 6,
        act: "resolution",
        emotionalBeat: "creative generosity — inclusion not charity",
        moralMoment: true,
        text: "فِكْرة خَطَرَت لمَرْيَم زي شُعاع. قامت وأخدت إيد سُعاد. «تعالي معايا.» سُعاد سَحَبَت إيدها: «لأ، أنا ما عرفش...» مَرْيَم ابْتَسَمَت: «مش لتاخدي حاجة. عشان تساعديني. ماما بتعمل صنية كَحْك تانية، ومحتاجة إيدين شاطرة. إنتي شاطرة، صح؟» سُعاد بَصِّت لها بِنَوْع من الدهشة، وفي الأخير هَزِّت راسها.",
        illustrationPrompt:
          "One girl pulling another by the hand toward an apartment door, gentle insistence with warmth, the second girl looking surprised but tempted, Cairo apartment hallway, watercolor style with hopeful turning point",
      },
      {
        number: 7,
        act: "resolution",
        emotionalBeat: "joyful belonging through co-creation",
        moralMoment: false,
        text: "في المطبخ، ماما رَحَّبَت بسُعاد كأنها بنتها. الست أم محمد ضِحْكَت: «يلا يا حبيبتي، علّميني أنا إزاي بتلفي.» سُعاد بدأت بخجل، بس بعد كم دقيقة، إيديها كانت بتشتغل بسرعة وبفرح. ضِحْكَت لأول مرة. مَرْيَم اتْفَرَّجَت عليها، وحست إن قلبها بقى أكبر من فستانها الجديد. الكَحْك اللي عملوه كان شكله مش متساوي، بس كان أحلى كَحْك في الدنيا.",
        illustrationPrompt:
          "Cairo apartment kitchen with three women and two girls all rolling kahk together at a flour-covered counter, the new girl now smiling and laughing, watercolor style with warm inclusive family scene",
      },
      {
        number: 8,
        act: "resolution",
        emotionalBeat: "dignity and friendship",
        moralMoment: false,
        text: "آخر اليوم، سُعاد طلعت من البيت ماسكة صنية كَحْك في إيدها — الكَحْك اللي عملته بإيديها. قالت لمَرْيَم: «هاخد ده لماما وبابا.» مَرْيَم حَضَنَتها. لما رجعت لماما، حَكَت لها كل حاجة. ماما قالت بهدوء: «الكَرَم الحقيقي مش إنك تدّي حاجة. الكَرَم إنك تخلي حد يحس إنه عُضْو في الفرحة.»",
        illustrationPrompt:
          "One girl proudly walking down apartment stairs holding a tray of kahk she made, the other girl waving from a doorway above, both smiling, watercolor warm sunset light, sense of meaningful resolution and dignity",
      },
    ],
  },
} as const;
