// Few-shot example #4 — Ramadan + Cooperation, age band 5-7, 12 pages.
// Target: ~60 words per page.
//
// Two new dimensions this example introduces (per Sprint 3 audit Gap H + J):
//   1. NON-8 page count (12 pages) — proves the model that pageCount comes
//      from the user message, not from "always 8 like the other examples"
//   2. POPULATED supportingCharacters in the wizard input (Nada, older sister)
//      with explicit demonstration of how she appears in the story AND in
//      every charactersOnPage where she's visible — closes the gap where
//      the model treats supporting characters as narrative-only and forgets
//      the schema binding.
//
// Three-act structure across 12 pages:
//   - Setup pages 1-3 (25%): family announcement, Yahya wants to help alone
//   - Challenge pages 4-9 (50%): three attempts to prepare iftar solo, all fail
//   - Resolution pages 10-12 (25%): cooperation lands the iftar perfectly
//
// Moral lands through ACTION on page 9: Yahya asks Nada for help — the
// internal choice IS the cooperation moment, not narrated.

export const RAMADAN_COOPERATION_5_7 = {
  context: {
    childName: "يحيى",
    childAgeBand: "5-7",
    childAgeExact: 5,
    childGender: "boy",
    theme: "رمضان",
    moralValue: "التعاون",
    customScene: null,
    specialOccasion: "أول إفطار يحيى يساعد فيه ماما لما الأهل بييجوا البيت",
    supportingCharacters: [
      { name: "ندى", role: "older sister, 7 years old" },
    ],
  },

  story: {
    title: "يحيى وَترابِيزَة الإفطار",
    dedication: "إلى يَحْيَى — أحلى حاجة تعملها هي اللي بتعملها مع اللي بتحبهم.",
    coverDescription:
      "Yahya proudly arranging dates and small ceramic plates on a long Ramadan iftar table beside his sister Nada, warm late-afternoon light, family gathering anticipation",
    parentDiscussionQuestion:
      "إيه أحلى حاجة عملتها مع حد بتحبه، ولولا مساعدته كانت هتبقى صعبة عليك؟",
    moralStatement:
      "وفي الآخر، عرف يَحْيَى إن التعاون مش ضعف — التعاون هو السر اللي بيخلي الحاجات الصعبة سهلة، وبيخلي الفرحة أكبر.",
    pages: [
      {
        number: 1,
        act: "setup" as const,
        emotionalBeat: "morning anticipation, sense of importance",
        moralMoment: false,
        charactersOnPage: ["يحيى", "ماما"],
        keyObjectOrDetail: "round metal sahour tray with three dates and a glass of milk",
        text: "صَحِي يَحْيَى على ضوء السحور الخفيف. ماما كانت قاعدة على السفرة وفي إيدها صنية صغيرة فيها تلات تَمَرَات وكُبَّاية لبن. قالت بصوت دافي: «النهارده الأهل كلهم جايين عندنا الإفطار يا يحيى. هتساعدنا نجهز السفرة؟» يَحْيَى هَزِّ راسه بحماس قوي.",
        scene:
          "Yahya at the sahour table at dawn, mother placing a small metal tray with dates and milk in front of him",
      },
      {
        number: 2,
        act: "setup" as const,
        emotionalBeat: "self-importance, pride in being grown",
        moralMoment: false,
        charactersOnPage: ["يحيى", "ماما"],
        keyObjectOrDetail: "handwritten task list on a folded paper square",
        text: "بعد ما خلصوا السحور، طَلَّعَت ماما ورقة صغيرة فيها مكتوب كل حاجة لازم تتعمل: «الأطباق، المناديل، طَبَق التَمْر، صنية الكَحْك.» يَحْيَى بَصِّ على الورقة وقال بفخر: «أنا هعمل ده كله لوحدي. أنا كبير دلوقتي.» ماما ابتسمت بهدوء.",
        scene:
          "Yahya holding the handwritten task list with a determined expression, mother smiling quietly beside him",
      },
      {
        number: 3,
        act: "setup" as const,
        emotionalBeat: "rebuffing offered help — the disruption",
        moralMoment: false,
        charactersOnPage: ["يحيى", "ندى"],
        keyObjectOrDetail: "Yahya's small white toy chef apron tied at his waist",
        text: "ندى، أخته الكبيرة، شافته لابس مَريلَة المطبخ الصغيرة بتاعته. قالت له بلطف: «تحب أساعدك يا يحيى؟» يَحْيَى نَفَّض إيده في الهوا وقال: «لأ يا ندى، أنا لوحدي. ده شغل الكبار.» ندى سَكَتَت ومشيت ناحية الصالة.",
        scene:
          "Yahya in a small chef apron waving his hand dismissively at his older sister Nada, she steps back with patient kindness",
      },
      {
        number: 4,
        act: "challenge" as const,
        emotionalBeat: "first attempt — overreach",
        moralMoment: false,
        charactersOnPage: ["يحيى"],
        keyObjectOrDetail: "stack of eight small ceramic dessert plates between his hands",
        text: "راح يَحْيَى المطبخ. شاف تمن أطباق صغيرة في الدولاب وقال: «هاخدهم كلهم مرة واحدة!» شَالهم بإيديه التِّنْتين، بس الأطباق كانت تقيلة عليه. مِشي بِبُطْء ناحية الترابيزة، وقلبه بيدق. خطوة، خطوتين، تلاتة...",
        scene:
          "Yahya carefully carrying a tall stack of eight small ceramic plates between both hands, walking nervously toward the dining table",
      },
      {
        number: 5,
        act: "challenge" as const,
        emotionalBeat: "first attempt fails — frustration",
        moralMoment: false,
        charactersOnPage: ["يحيى", "ندى"],
        keyObjectOrDetail: "two ceramic plates lying broken on the terracotta floor",
        text: "فَجْأة، طَبَقين وقعوا واتكسروا على البلاط. يَحْيَى وقف مَكَانه، عينيه فيها دموع صغيرة. ندى ظهرت من الصالة وقالت: «معلش يا يحيى، أنا أساعدك أنضف؟» بس يَحْيَى مَسَح عينيه بسرعة وقال بصوت مكتوم: «لأ! أنا هعمل كل حاجة لوحدي.»",
        scene:
          "Two broken ceramic plates on the terracotta floor at Yahya's feet, Nada standing in the doorway with concern, Yahya wiping his eye with the back of his hand",
      },
      {
        number: 6,
        act: "challenge" as const,
        emotionalBeat: "second attempt — fumbling",
        moralMoment: false,
        charactersOnPage: ["يحيى"],
        keyObjectOrDetail: "white cotton napkin with delicate gold-thread embroidered border",
        text: "بَصِّ على المناديل البيضا اللي على الترابيزة. كانت محتاجة تتطوي بشكل حلو. يَحْيَى جَرَّب يطويها زي ما شاف ماما بتعمل. طويها مرة، طويها تاني، بَصِّ عليها — كانت طلعت زي كرة مَلَفُوفة مش زي مثلث جميل. ضِحِك بنوع غريب من الإحراج.",
        scene:
          "Yahya at the long dining table holding a crumpled white cotton napkin in his small hands, looking down at it with embarrassed confusion",
      },
      {
        number: 7,
        act: "challenge" as const,
        emotionalBeat: "time pressure, sun setting",
        moralMoment: false,
        charactersOnPage: ["يحيى"],
        keyObjectOrDetail: "round wall clock showing twenty minutes to maghrib sunset",
        text: "يَحْيَى بَصِّ على ساعة الحيطة. عشرين دقيقة وبس على المغرب. الشمس كانت بتغيب من الشباك، والضو في الأوضة بقى لونه دهبي. لسه التمر مش متحطّ، والكَحْك لسه في عُلبته. قلب يَحْيَى الصغير بدأ يدق بسرعة. «أنا هخلص ولا لأ؟»",
        scene:
          "Yahya looking up at a round wall clock, golden sunset light streaming through the window behind him, the dining table half-set",
      },
      {
        number: 8,
        act: "challenge" as const,
        emotionalBeat: "third attempt — physical defeat",
        moralMoment: false,
        charactersOnPage: ["يحيى", "ندى"],
        keyObjectOrDetail: "large copper kahk tin with floral engraved pattern, lid half-open",
        text: "راح ناحية عُلْبَة الكَحْك النحاسية الكبيرة. كانت ثقيلة عليه. حاول يشيلها من على الرف، بس إيديه ارتعشت، والعُلبة وقعت. الكَحْك اتفرتك على الأرض كله. يَحْيَى قعد على ركبته جنب الكَحْك المنتشر. ندى دخلت بهدوء ووقفت في الباب.",
        scene:
          "Yahya kneeling on the floor surrounded by scattered kahk biscuits from a fallen copper tin, Nada standing quietly in the doorway watching with empathy",
      },
      {
        number: 9,
        act: "challenge" as const,
        emotionalBeat: "the choice — asking for help",
        moralMoment: true,
        charactersOnPage: ["يحيى", "ندى"],
        keyObjectOrDetail: "Yahya's small open hand reaching out toward Nada",
        text: "يَحْيَى رَفَع راسه وبَصِّ على ندى. شاف وشها الحنين، وعيونها اللي مش بتحكم عليه. أَخَد نَفَس عميق. مَدِّ إيده الصغيرة ناحيتها وقال بصوت هاديء: «ندى، تساعديني؟» ندى ابتسمت وقعدت جنبه على البلاط، وبدأت تلم الكَحْك معاه.",
        scene:
          "Yahya kneeling on the floor reaching out his small open hand toward Nada, who is now crouching beside him beginning to gather kahk biscuits together",
      },
      {
        number: 10,
        act: "resolution" as const,
        emotionalBeat: "joy of working together",
        moralMoment: false,
        charactersOnPage: ["يحيى", "ندى"],
        keyObjectOrDetail: "long iftar table neatly set with date plates, kahk tray, folded napkins",
        text: "اشتغلوا مع بعض. ندى طَوِّت المناديل بِسُرعة وأناقة. يَحْيَى حَطِّ التَمَرَات في طبقهم. سَوا رتبوا الكَحْك في صنية حلوة. الترابيزة بدأت تبان جميلة — أحلى من اللي يَحْيَى كان متخيله لما كان لوحده.",
        scene:
          "Yahya and Nada working side by side at a long beautifully-set iftar table, plates and dates and kahk all arranged in neat rows, warm late-afternoon light",
      },
      {
        number: 11,
        act: "resolution" as const,
        emotionalBeat: "family arrival, shared accomplishment",
        moralMoment: false,
        charactersOnPage: ["يحيى", "ندى", "ماما", "العائلة"],
        keyObjectOrDetail: "steaming bowls of lentil soup placed at each table setting",
        text: "أذان المغرب أَذَّن. الأهل دخلوا ومالوا الصالة. ماما حَطِّت شُوربة العَدَس السخنة قُدَّام كل واحد. الكُل بَصِّ على الترابيزة وقال: «ما شاء الله، حاجة جميلة!» ماما ابتسمت ليَحْيَى وندى وقالت: «اللي عملوا ده يحيى وندى مع بعض.»",
        scene:
          "Family gathered around the iftar table at sunset, steaming lentil soup at every place, mother smiling proudly at Yahya and Nada from the head of the table",
      },
      {
        number: 12,
        act: "resolution" as const,
        emotionalBeat: "quiet shared pride between siblings",
        moralMoment: false,
        charactersOnPage: ["يحيى", "ندى"],
        keyObjectOrDetail: "two small glass cups of warm mint tea between them on a side table",
        text: "بعد ما الأهل خلصوا الإفطار وقعدوا في الصالة، يَحْيَى وندى قعدوا على البلكونة. كان قُدَّامهم كُبَّايتين شاي بالنعناع. يَحْيَى بَصِّ لها وقال بصوت واطي: «شكراً يا ندى.» ندى ضِحْكَت وقالت: «إحنا فريق.» يَحْيَى حَسِّ بحاجة دفية وكبيرة في صدره.",
        scene:
          "Yahya and Nada sitting together on a Cairo apartment balcony at dusk after iftar, two small glass cups of mint tea between them on a side table",
      },
    ],
  },
} as const;
