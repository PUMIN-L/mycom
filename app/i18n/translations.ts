export type Language = "th" | "en" | "zh";

export const translations = {
  // Navbar
  nav: {
    home: { th: "หน้าแรก", en: "Home", zh: "首页" },
    services: { th: "บริการ", en: "Services", zh: "服务" },
    products: { th: "สินค้า", en: "Products", zh: "产品" },
    about: { th: "เกี่ยวกับเรา", en: "About Us", zh: "关于我们" },
    clients: { th: "ลูกค้าของเรา", en: "Our Clients", zh: "我们的客户" },
    contact: { th: "ติดต่อเรา", en: "Contact", zh: "联系我们" },
  },

  // Hero Section
  hero: {
    tagline: {
      th: "ผู้เชี่ยวชาญด้านเครื่องมือทดสอบและสร้างห้องปฏิบัติการ",
      en: "Experts in Testing Equipment & Laboratory Solutions",
      zh: "测试设备与实验室解决方案专家",
    },
    title: {
      th: "โซลูชันการทดสอบครบวงจร",
      en: "Complete Testing Solutions",
      zh: "适用于各行业的",
    },
    subtitle: {
      th: "จำหน่าย ซ่อมบำรุง และสอบเทียบเครื่องมือทดสอบคุณภาพ\nพร้อมบริการออกแบบและสร้างห้องปฏิบัติการมาตรฐานสากล",
      en: "Sales, maintenance, and calibration of quality testing instruments\nwith design and construction services for international-standard laboratories.",
      zh: "销售、维修和校准优质测试仪器\n提供国际标准实验室的设计与建设服务。",
    },
    cta: {
      th: "ติดต่อเรา",
      en: "Contact Us",
      zh: "联系我们",
    },
    ctaLine: {
      th: "แชทผ่าน LINE",
      en: "Chat via LINE",
      zh: "通过LINE聊天",
    },
  },

  // Services
  services: {
    sectionTag: { th: "บริการของเรา", en: "Our Services", zh: "我们的服务" },
    title: {
      th: "บริการครบวงจรที่คุณวางใจ",
      en: "Comprehensive Services You Can Trust",
      zh: "您值得信赖的全方位服务",
    },
    subtitle: {
      th: "เราให้บริการครอบคลุมทุกความต้องการด้านเครื่องมือทดสอบและห้องปฏิบัติการ",
      en: "We cover all your testing equipment and laboratory needs.",
      zh: "我们满足您在测试设备和实验室方面的所有需求。",
    },
    items: [
      {
        icon: "sales",
        title: { th: "จำหน่ายเครื่องมือทดสอบ", en: "Equipment Sales", zh: "设备销售" },
        desc: {
          th: "จำหน่ายเครื่องมือทดสอบคุณภาพจากแบรนด์ชั้นนำ พร้อมให้คำปรึกษาในการเลือกเครื่องที่เหมาะสม",
          en: "Quality testing equipment from leading brands with expert consultation for the right selection.",
          zh: "提供知名品牌的优质测试设备，并提供专业选型咨询。",
        },
      },
      {
        icon: "service",
        title: { th: "ซ่อมบำรุงและสอบเทียบ", en: "Service & Calibration", zh: "维修与校准" },
        desc: {
          th: "บริการซ่อมบำรุง ดูแลรักษา และสอบเทียบเครื่องมือทดสอบทุกประเภท โดยทีมวิศวกรผู้เชี่ยวชาญ",
          en: "Maintenance, repair, and calibration for all types of testing equipment by expert engineers.",
          zh: "由专业工程师团队提供各类测试设备的维修、保养 and 校准服务。",
        },
      },
      {
        icon: "lab",
        title: { th: "ออกแบบและสร้างห้องแลป", en: "Lab Design & Construction", zh: "实验室设计与建设" },
        desc: {
          th: "ออกแบบและก่อสร้างห้องปฏิบัติการมาตรฐานสากล",
          en: "Design and build international-standard laboratories.",
          zh: "设计和建设国际标准实验室。",
        },
      },
    ],
  },

  // Products
  products: {
    title: { th: "สินค้าของเรา", en: "Our Products", zh: "我们的产品" },
    subtitle: { th: "เครื่องมือทดสอบคุณภาพสูง", en: "High-Quality Testing Equipment", zh: "高品质测试设备" },
    categories: [
      { th: "เครื่องมือวัดขนาด", en: "Measuring Tools", zh: "测量工具" },
      { th: "ตู้อบความร้อน", en: "Heating Ovens", zh: "加热箱" },
      { th: "เครื่องทดสอบวัสดุ", en: "Material Testers", zh: "材料测试仪" },
      { th: "เครื่องวัดสี", en: "Color Meters", zh: "色差仪" },
      { th: "เครื่องชั่งดิจิตอล", en: "Digital Balances", zh: "数显台秤" },
      { th: "เครื่องชั่งความละเอียดสูง", en: "Precision Balances", zh: "精密天平" },
      { th: "เครื่องมือทดสอบอื่นๆ", en: "Other Testers", zh: "其他测试仪" },
    ],
    items: [
      // Category 0: Small Tools
      {
        categoryId: 0,
        image: "/images/digital-caliper.png",
        title: { th: "เวอร์เนียร์ดิจิตอล", en: "Digital Caliper", zh: "数显卡尺" },
        desc: {
          th: "เครื่องมือวัดขนาดภายนอก ภายใน และความลึกแบบดิจิตอลความแม่นยำสูง",
          en: "High-precision digital tool for measuring internal, external, and depth dimensions.",
          zh: "高精度数显工具，用于测量内外径及深度尺寸。",
        },
      },
      {
        categoryId: 0,
        image: "/images/micrometer.png",
        title: { th: "ไมโครมิเตอร์", en: "Micrometer", zh: "千分尺" },
        desc: {
          th: "เครื่องมือวัดขนาดที่มีความละเอียดสูงพิเศษ สำหรับงานวิศวกรรมที่ต้องการความแม่นยำ",
          en: "Ultra-high resolution measuring tool for precision engineering tasks.",
          zh: "超高分辨率测量工具，适用于精密工程任务。",
        },
      },
      {
        categoryId: 0,
        image: "/images/dial-gauge.png",
        title: { th: "ไดอัลเกจ", en: "Dial Gauge", zh: "百分表" },
        desc: {
          th: "เครื่องมือวัดความคลาดเคลื่อนของตำแหน่งและระนาบ",
          en: "Instrument for measuring position and flatness deviations.",
          zh: "用于测量位置和平面度偏差的仪器。",
        },
      },

      // Category 1: Hot Air Oven
      {
        categoryId: 1,
        image: "/images/industrial-oven.png",
        title: { th: "ตู้อบลมร้อนอุตสาหกรรม", en: "Industrial Hot Air Oven", zh: "工业热风烘箱" },
        desc: {
          th: "ตู้อบความร้อนสูงสำหรับการแปรรูปและทดสอบวัสดุในอุตสาหกรรม",
          en: "High-temperature oven for material processing and industrial testing.",
          zh: "用于材料处理和工业测试的高温烘箱。",
        },
      },
      {
        categoryId: 1,
        image: "/images/hot-air-oven.png",
        title: { th: "ตู้อบแห้งในห้องปฏิบัติการ", en: "Laboratory Drying Oven", zh: "实验室干燥箱" },
        desc: {
          th: "ตู้อบสำหรับงานวิเคราะห์และอบแห้งเครื่องแก้วในห้องแล็บ",
          en: "Oven for analytical tasks and drying glassware in laboratories.",
          zh: "用于实验室分析任务和玻璃器皿干燥的烘箱。",
        },
      },
      {
        categoryId: 1,
        image: "/images/industrial-oven.png",
        title: { th: "ตู้อบสุญญากาศ", en: "Vacuum Drying Oven", zh: "真空干燥箱" },
        desc: {
          th: "ตู้อบความร้อนในสภาวะสุญญากาศ ป้องกันการเกิดปฏิกิริยาออกซิเดชัน",
          en: "Heat treatment in vacuum conditions to prevent oxidation.",
          zh: "真空条件下的热处理，防止氧化。",
        },
      },

      // Category 2: Film & Plastic Tester
      {
        categoryId: 2,
        image: "/images/cof-tester.png",
        title: { th: "เครื่องวัดค่า COF", en: "COF Tester", zh: "摩擦系数测试仪" },
        desc: {
          th: "วัดค่าสัมประสิทธิ์แรงเสียดทานของฟิล์มและบรรจุภัณฑ์",
          en: "Measure coefficient of friction for films and packaging.",
          zh: "测量薄膜和包装材料的摩擦系数。",
        },
      },
      // {
      //   categoryId: 2,
      //   image: "/images/film-tester.png",
      //   title: { th: "เครื่องทดสอบฟิล์ม", en: "Film Property Tester", zh: "薄膜性能测试仪" },
      //   desc: {
      //     th: "ทดสอบคุณสมบัติการดึงและฉีกขาดของพลาสติกฟิล์ม",
      //     en: "Test tensile and tear properties of plastic films.",
      //     zh: "测试塑料薄膜的拉伸和撕裂性能。",
      //   },
      // },
      // {
      //   categoryId: 2,
      //   image: "/images/compression-tester.png",
      //   title: { th: "เครื่องทดสอบแรงกด", en: "Compression Tester", zh: "压力试验机" },
      //   desc: {
      //     th: "ทดสอบแรงกด ความแข็งแรง และความทนทานของวัสดุ",
      //     en: "Test compression strength and durability of materials.",
      //     zh: "测试材料的抗压强度和耐久性。",
      //   },
      // },
      {
        categoryId: 2,
        image: "/images/viscometer.png",
        title: { th: "เครื่องวัดความหนืด", en: "Viscometer", zh: "粘度计" },
        desc: {
          th: "วัดค่าความหนืดของของเหลว สี หมึก กาว และอื่นๆ",
          en: "Measure viscosity of liquids, paints, inks, and adhesives.",
          zh: "测量液体、油漆、油墨和粘合剂的粘度。",
        },
      },
      {
        categoryId: 2,
        image: "/images/film-tester.png",
        title: { th: "เครื่องวัดความหนาฟิล์ม", en: "Film Thickness Gauge", zh: "薄膜测厚仪" },
        desc: {
          th: "วัดความหนาของแผ่นฟิล์มและพลาสติกแบบละเอียด",
          en: "Precise measurement of film and plastic sheet thickness.",
          zh: "精确测量薄膜和塑料片的厚度。",
        },
      },

      // Category 3: Color Meter/Colorimeter
      {
        categoryId: 3,
        image: "/images/colorimeter.png",
        title: { th: "เครื่องวัดสี", en: "Portable Colorimeter", zh: "便携式色差仪" },
        desc: {
          th: "เครื่องวัดสีแบบพกพา แม่นยำสูง สำหรับงานควบคุมคุณภาพ",
          en: "High-precision portable color meter for quality control.",
          zh: "高精度便携式色差仪，用于质量控制。",
        },
      },
      {
        categoryId: 3,
        image: "/images/colorimeter.png",
        title: { th: "สเปกโตรโฟโตมิเตอร์", en: "Spectrophotometer", zh: "分光光度计" },
        desc: {
          th: "วิเคราะห์ค่าสีเชิงลึกและวัดค่าการสะท้อนแสง",
          en: "In-depth color analysis and light reflectance measurement.",
          zh: "深入的颜色分析和光反射率测量。",
        },
      },
      {
        categoryId: 3,
        image: "/images/colorimeter.png",
        title: { th: "เครื่องวัดความเงา", en: "Gloss Meter", zh: "光泽度计" },
        desc: {
          th: "วัดค่าความเงาของพื้นผิววัสดุหลายมุมมอง",
          en: "Measure surface gloss of materials from multiple angles.",
          zh: "从多个角度测量材料的表面光泽度。",
        },
      },

      // Category 4: Bench Scale / Table Scale
      {
        categoryId: 4,
        image: "/images/bench-scale.png",
        title: { th: "เครื่องชั่งตั้งโต๊ะดิจิตอล", en: "Digital Bench Scale", zh: "数显台秤" },
        desc: {
          th: "เครื่องชั่งตั้งโต๊ะความแม่นยำสูงสำหรับงานทั่วไป",
          en: "High-precision bench scale for general purposes.",
          zh: "用于通用目的的高精度台秤。",
        },
      },
      {
        categoryId: 4,
        image: "/images/bench-scale.png",
        title: { th: "เครื่องชั่งนับจำนวน", en: "Counting Scale", zh: "计数秤" },
        desc: {
          th: "ฟังก์ชันนับจำนวนชิ้นงานความแม่นยำสูง",
          en: "High-precision piece counting function.",
          zh: "高精度的零件计数功能。",
        },
      },
      {
        categoryId: 4,
        image: "/images/bench-scale.png",
        title: { th: "เครื่องชั่งกันน้ำ", en: "Waterproof Table Scale", zh: "防水桌秤" },
        desc: {
          th: "ทนทานต่อความชื้นและน้ำ เหมาะสำหรับอุตสาหกรรมอาหาร",
          en: "Moisture and water resistant, ideal for food industry.",
          zh: "防潮防水，是食品行业的理想选择。",
        },
      },

      // Category 5: Precision Balance
      {
        categoryId: 5,
        image: "/images/analytical-balance.png",
        title: { th: "เครื่องชั่งวิเคราะห์", en: "Analytical Balance", zh: "分析天平" },
        desc: {
          th: "ความละเอียดสูงพิเศษ 4-5 ตำแหน่ง สำหรับงานแล็บ",
          en: "Ultra-high resolution (4-5 digits) for laboratory work.",
          zh: "超高分辨率（4-5位），用于实验室工作。",
        },
      },
      {
        categoryId: 5,
        image: "/images/precision-balance.png",
        title: { th: "เครื่องชั่งความแม่นยำสูง", en: "Precision Balance", zh: "精密天平" },
        desc: {
          th: "ชั่งน้ำหนักได้รวดเร็วและแม่นยำ พร้อมระบบกันลม",
          en: "Fast and accurate weighing with windshield system.",
          zh: "配备防风罩系统的快速准确称重。",
        },
      },

      // Category 6: Other Testers
      {
        categoryId: 6,
        image: "/images/hardness-tester.png",
        title: { th: "เครื่องวัดความแข็ง", en: "Durometer", zh: "邵氏硬度计" },
        desc: {
          th: "วัดความแข็งของโลหะ พลาสติก และยาง",
          en: "Measure hardness of metals, plastics, and rubber.",
          zh: "测量金属、塑料和橡胶的硬度值。",
        },
      },
      {
        categoryId: 6,
        image: "/images/leak-tester.png",
        title: { th: "เครื่องทดสอบการรั่วซึม", en: "Leak Tester", zh: "泄漏测试仪" },
        desc: {
          th: "ตรวจสอบความสมบูรณ์ของบรรจุภัณฑ์",
          en: "Check the integrity of packaging.",
          zh: "检查包装的完整性。",
        },
      },
    ],
  },

  // Clients
  clients: {
    sectionTag: { th: "ลูกค้าของเรา", en: "Our Clients", zh: "我们的客户" },
    title: {
      th: "ได้รับความไว้วางใจจากองค์กรชั้นนำ",
      en: "Trusted by Leading Organizations",
      zh: "深受领先企业信赖",
    },
    subtitle: {
      th: "เราภูมิใจที่ได้ร่วมงานกับบริษัทชั้นนำมากมายทั่วประเทศ",
      en: "We're proud to work with leading companies nationwide.",
      zh: "我们很荣幸与全国各地的领先企业合作。",
    },
  },

  // Contact
  contact: {
    sectionTag: { th: "ติดต่อเรา", en: "Contact Us", zh: "联系我们" },
    title: {
      th: "พร้อมให้บริการ",
      en: "Ready to Serve You",
      zh: "随时为您服务",
    },
    subtitle: {
      th: "ติดต่อเราได้ทุกช่องทาง เรายินดีให้คำปรึกษาและบริการ",
      en: "Reach us through any channel. We're happy to assist.",
      zh: "通过任何渠道联系我们，我们很乐意为您提供帮助。",
    },
    address: {
      th: "89/99 ถ.ติวานนท์ ต.บางกระสอ อ.เมืองนนทบุรี จ.นนทบุรี 11000",
      en: "89/99 Tiwanon Rd., Bang Kra Sor, Mueang Nonthaburi, Nonthaburi 11000, Thailand",
      zh: "泰国暖武里府暖武里市邦沙叻镇蒂瓦侬路89/99号 11000",
    },
    phone: {
      th: "02-xxx-xxxx",
      en: "02-xxx-xxxx",
      zh: "02-xxx-xxxx",
    },
    email: {
      th: "ampumin@gmail.com",
      en: "ampumin@gmail.com",
      zh: "ampumin@gmail.com",
    },
    form: {
      name: { th: "ชื่อ-นามสกุล", en: "Full Name", zh: "姓名" },
      email: { th: "อีเมล", en: "Email", zh: "电子邮件" },
      subject: { th: "หัวข้อ", en: "Subject", zh: "主题" },
      message: { th: "ข้อความ", en: "Message", zh: "留言内容" },
      send: { th: "ส่งข้อความ", en: "Send Message", zh: "发送消息" },
      sending: { th: "กำลังส่ง...", en: "Sending...", zh: "发送中..." },
      success: {
        th: "ส่งข้อความเรียบร้อยแล้ว!",
        en: "Message sent successfully!",
        zh: "消息发送成功！",
      },
    },
    addressLabel: { th: "ที่อยู่", en: "Address", zh: "地址" },
    phoneLabel: { th: "โทรศัพท์", en: "Phone", zh: "电话" },
    emailLabel: { th: "อีเมล", en: "Email", zh: "电子邮件" },
    lineLabel: { th: "LINE", en: "LINE", zh: "LINE" },
  },

  // About Page
  aboutPage: {
    tag: { th: "เกี่ยวกับ Profin Lab Scale", en: "About Profin Lab Scale", zh: "关于 Profin Lab Scale" },
    title: { th: "ขับเคลื่อนคุณภาพด้วยความแม่นยำ", en: "Empowering Quality through Precision", zh: "通过精准助力质量提升" },
    description: {
      th: "ด้วยความเชี่ยวชาญกว่าทศวรรษ เรานำเสนอโซลูชันการทดสอบระดับโลกที่ช่วยให้อุตสาหกรรมบรรลุมาตรฐานคุณภาพและความน่าเชื่อถือสูงสุด",
      en: "With over a decade of expertise, we provide world-class testing solutions that help industries achieve the highest standards of quality and reliability.",
      zh: "凭借十多年的专业知识，我们提供世界一流的测试解决方案，帮助各行各业实现最高标准的质量和可靠性。",
    },
    visionTitle: { th: "วิสัยทัศน์ของเรา", en: "Our Vision", zh: "我们的愿景" },
    visionDesc: {
      th: "มุ่งสู่การเป็นผู้นำด้านโซลูชันห้องปฏิบัติการนวัตกรรมในเอเชียตะวันออกเฉียงใต้ เป็นที่ยอมรับในด้านความแม่นยำ ความซื่อสัตย์ และความสำเร็จของลูกค้า เราเชื่อว่าการทดสอบที่แม่นยำคือรากฐานของทุกผลิตภัณฑ์ที่ยอดเยี่ยม",
      en: "To be the leading provider of innovative laboratory solutions in Southeast Asia, recognized for our commitment to precision, integrity, and customer success. We believe that accurate testing is the foundation of every great product.",
      zh: "成为东南亚领先的创新实验室解决方案提供商，因我们对精准、诚信和客户成功的承诺而受到认可。我们相信，准确的测试是每一件优秀产品的基础。",
    },
    expYears: { th: "ปีแห่งประสบการณ์", en: "Years Experience", zh: "多年经验" },
    projectsDone: { th: "โครงการที่เสร็จสิ้น", en: "Projects Completed", zh: "完成项目" },
    valuesTitle: { th: "ค่านิยมของเรา", en: "Our Values", zh: "我们的价值观" },
    value1Title: { th: "คุณภาพที่ไม่มีข้อโต้แย้ง", en: "Uncompromising Quality", zh: "不妥协的品质" },
    value1Desc: { th: "เราเลือกเฉพาะแบรนด์ที่เป็นไปตามมาตรฐานสากลที่เข้มงวดที่สุดเท่านั้น", en: "We only represent brands that meet the most rigorous international standards.", zh: "我们仅代理符合最严格国际标准的品牌。" },
    value2Title: { th: "การให้คำปรึกษาโดยผู้เชี่ยวชาญ", en: "Expert Consultation", zh: "专家咨询" },
    value2Desc: { th: "วิศวกรของเราไม่ใช่แค่พนักงานขาย แต่เป็นผู้เชี่ยวชาญที่เข้าใจความต้องการทางเทคนิคของคุณ", en: "Our engineers aren't just salespeople; they are experts who understand your technical needs.", zh: "我们的工程师不仅仅是销售人员；他们是了解您技术需求的专家。" },
    value3Title: { th: "การสนับสนุนตลอดอายุการใช้งาน", en: "Lifelong Support", zh: "终身支持" },
    value3Desc: { th: "เรายืนหยัดเคียงข้างเครื่องมือของเราด้วยบริการซ่อมบำรุงและสอบเทียบที่ครบวงจร", en: "We stand by our equipment with comprehensive maintenance and calibration services.", zh: "我们通过全面的维护 and 校准服务，为我们的设备提供支持。" },
  },

  // Footer
  footer: {
    description: {
      th: "ผู้เชี่ยวชาญด้านเครื่องมือทดสอบและสร้างห้องปฏิบัติการ ให้บริการจำหน่าย ซ่อมบำรุง และสอบเทียบ",
      en: "Experts in testing equipment and laboratory construction. Sales, service, and calibration.",
      zh: "测试设备与实验室建设专家。提供销售、维修和校准服务。",
    },
    quickLinks: { th: "ลิงก์ด่วน", en: "Quick Links", zh: "快速链接" },
    contactInfo: { th: "ข้อมูลติดต่อ", en: "Contact Info", zh: "联系信息" },
    copyright: {
      th: "© 2026 Profin Lab Scale",
      en: "© 2026 Profin Lab Scale",
      zh: "© 2026 Profin Lab Scale",
    },
  },
} as const;

export type TranslationKey = keyof typeof translations;
