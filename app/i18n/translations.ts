export type Language = "th" | "en" | "zh";

export const translations = {
  // Navbar
  nav: {
    home: { th: "หน้าแรก", en: "Home", zh: "首页" },
    services: { th: "บริการ", en: "Services", zh: "服务" },
    products: { th: "สินค้า", en: "Products", zh: "产品" },
    catalog: { th: "แคตตาล็อก", en: "Catalog", zh: "产品目录" },
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
    // The home page's <h1>: it names what the business sells (the words people
    // search for), not just a slogan. The Thai one is what Google indexes.
    title: {
      th: "เครื่องมือวัดและเครื่องทดสอบคุณภาพ ครบวงจร",
      en: "Testing & Measuring Instruments — Complete Solutions",
      zh: "测试与测量仪器一站式解决方案",
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
          zh: "由专业工程师团队提供各类测试设备的维修、保养和校准服务。",
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

  // Products (data now in database — only section headers for i18n)
  products: {
    title: { th: "สินค้าของเรา", en: "Our Products", zh: "我们的产品" },
    subtitle: { th: "เครื่องมือทดสอบคุณภาพสูง", en: "High-Quality Testing Equipment", zh: "高品质测试设备" },
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
    form: {
      name: { th: "ชื่อ-นามสกุล", en: "Full Name", zh: "姓名" },
      email: { th: "อีเมล", en: "Email", zh: "电子邮件" },
      phone: { th: "เบอร์โทร", en: "Phone Number", zh: "电话号码" },
      subject: { th: "หัวข้อ", en: "Subject", zh: "主题" },
      message: { th: "ข้อความ", en: "Message", zh: "留言内容" },
      send: { th: "ส่งข้อความ", en: "Send Message", zh: "发送消息" },
      sending: { th: "กำลังส่ง...", en: "Sending...", zh: "发送中..." },
      success: {
        th: "ส่งข้อความเรียบร้อยแล้ว!",
        en: "Message sent successfully!",
        zh: "消息发送成功！",
      },
      error: {
        th: "ส่งข้อความไม่สำเร็จ กรุณาลองใหม่",
        en: "Failed to send. Please try again.",
        zh: "发送失败，请重试。",
      },
      errorPhone: {
        th: "รูปแบบเบอร์โทรไม่ถูกต้อง (ต้องเป็นตัวเลข 9-10 หลัก)",
        en: "Invalid phone number (must be 9-10 digits).",
        zh: "电话号码格式无效（必须为 9-10 位数字）。",
      },
      errorRateLimit: {
        th: "ส่งข้อความบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
        en: "Too many messages. Please wait a moment and try again.",
        zh: "发送过于频繁，请稍后重试。",
      },
      errorUnavailable: {
        th: "ระบบส่งอีเมลยังไม่พร้อมใช้งาน กรุณาติดต่อผ่าน LINE",
        en: "Email is temporarily unavailable — please contact us via LINE.",
        zh: "邮件系统暂不可用，请通过 LINE 联系我们。",
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

  // Catalog Page
  catalogPage: {
    title: { th: "แคตตาล็อกสินค้า", en: "Product Catalogs", zh: "产品目录" },
    description: {
      th: "เรียกดูและดาวน์โหลดโบรชัวร์ แคตตาล็อกสินค้า และเอกสารข้อมูลทางเทคนิคของเรา",
      en: "Explore our extensive collection of product catalogs, brochures, and technical documents.",
      zh: "浏览和下载我们的产品目录、宣传册和技术文档。",
    },
    noCatalogs: {
      th: "ยังไม่มีแคตตาล็อกในขณะนี้",
      en: "No catalogs available at the moment.",
      zh: "目前没有可用的目录。",
    },
    viewPdf: { th: "เปิดดู", en: "View PDF", zh: "查看 PDF" },
  },

  // Product pages: /products, /products/[category], and the "related" links
  // at the foot of a /showcase content page
  productPages: {
    related: { th: "สินค้าที่เกี่ยวข้อง", en: "Related Products", zh: "相关产品" },
    seeAllInCategory: { th: "ดูสินค้าทั้งหมดในหมวด", en: "See all products in", zh: "查看此类别全部产品：" },
    viewDetails: { th: "ดูรายละเอียด", en: "View Details", zh: "查看详情" },
    allProducts: { th: "สินค้าทั้งหมด", en: "All Products", zh: "全部产品" },
    browseByCategory: { th: "ดูสินค้าทั้งหมดแยกตามหมวดหมู่", en: "Browse all products by category", zh: "按类别浏览全部产品" },
    allTitle: {
      th: "เครื่องมือวัดและเครื่องทดสอบทั้งหมด",
      en: "All Testing & Measuring Instruments",
      zh: "全部测试与测量仪器",
    },
    allIntro: {
      th: "รวมเครื่องมือวัดและเครื่องทดสอบทุกหมวดที่โปรฟิน แล็บสเกลจำหน่าย แยกตามประเภท พร้อมบริการติดตั้ง สอนการใช้งาน ซ่อมบำรุง และสอบเทียบ",
      en: "Every testing and measuring instrument Profin Lab Scale supplies, by category — with installation, training, maintenance and calibration.",
      zh: "Profin Lab Scale 供应的全部测试与测量仪器，按类别分类，并提供安装、培训、维修和校准服务。",
    },
    // {name} is the category's name.
    categoryIntro: {
      th: "รวม{name}ที่โปรฟิน แล็บสเกลจำหน่าย พร้อมให้คำปรึกษาเลือกรุ่นที่เหมาะกับงาน ติดตั้ง สอนการใช้งาน ซ่อมบำรุง และสอบเทียบ",
      en: "{name} supplied by Profin Lab Scale, with advice on choosing the right model, installation, training, maintenance and calibration.",
      zh: "Profin Lab Scale 供应的{name}，并提供选型咨询、安装、培训、维修和校准服务。",
    },
    // {n} is a number.
    itemCount: { th: "{n} รายการ", en: "{n} items", zh: "{n} 款" },
    viewCategory: { th: "ดูทั้งหมวด", en: "View category", zh: "查看类别" },
    otherCategories: { th: "หมวดหมู่อื่น", en: "Other Categories", zh: "其他类别" },
    askQuote: { th: "สอบถามราคาและรายละเอียด", en: "Ask for a Quote", zh: "咨询价格与详情" },
  },

  // Service pages (/services/[slug]) — the three services on the home page,
  // each with a page of its own. Keyed by slug (lib/servicePages.ts).
  servicePages: {
    learnMore: { th: "ดูรายละเอียดบริการ", en: "Learn More", zh: "了解详情" },
    otherServices: { th: "บริการอื่นของเรา", en: "Our Other Services", zh: "我们的其他服务" },
    ctaTitle: { th: "ปรึกษาเรื่องนี้กับเรา", en: "Talk to Us About This", zh: "与我们联系咨询" },
    ctaText: {
      th: "บอกงานที่คุณต้องการ แล้วเราจะช่วยแนะนำ",
      en: "Tell us what you need and we will advise you.",
      zh: "告诉我们您的需求，我们将为您提供建议。",
    },
    browseProducts: { th: "ดูสินค้าทั้งหมด", en: "Browse All Products", zh: "浏览全部产品" },
    pages: {
      "equipment-sales": {
        title: {
          th: "จำหน่ายเครื่องมือวัดและเครื่องทดสอบ",
          en: "Testing & Measuring Equipment Sales",
          zh: "测试与测量仪器销售",
        },
        metaDescription: {
          th: "โปรฟิน แล็บสเกล จำหน่ายเครื่องมือวัดและเครื่องทดสอบคุณภาพจากแบรนด์ชั้นนำ พร้อมให้คำปรึกษาเลือกรุ่น ติดตั้ง และสอนการใช้งาน สำหรับห้องแลปและงาน QC",
          en: "Profin Lab Scale supplies quality testing and measuring equipment from leading brands, with model selection advice, installation and training.",
          zh: "Profin Lab Scale 供应知名品牌的优质测试与测量仪器，并提供选型咨询、安装及培训。",
        },
        intro: {
          th: "เราจำหน่ายเครื่องมือทดสอบคุณภาพจากแบรนด์ชั้นนำ สำหรับห้องปฏิบัติการและงานควบคุมคุณภาพ (QC) ในอุตสาหกรรม พร้อมให้คำปรึกษาในการเลือกเครื่องที่เหมาะกับงานของคุณ ติดตั้ง และสอนการใช้งานให้ทีมงาน",
          en: "We supply quality testing equipment from leading brands for industrial laboratories and quality control (QC), with expert advice on choosing the right instrument, installation, and training for your team.",
          zh: "我们为工业实验室和质量控制（QC）提供知名品牌的优质测试设备，并提供专业选型咨询、安装及操作培训。",
        },
        listTitle: { th: "เครื่องมือที่เราจำหน่าย", en: "Equipment We Supply", zh: "我们供应的设备" },
        list: [
          { th: "เครื่องทดสอบแรงดึง (Tensile Tester / UTM)", en: "Tensile testers / Universal Testing Machines (UTM)", zh: "拉力试验机 / 万能材料试验机（UTM）" },
          { th: "เครื่องทดสอบฟิล์ม พลาสติก และบรรจุภัณฑ์", en: "Film, plastic and packaging testers", zh: "薄膜、塑料及包装测试仪" },
          { th: "เครื่องวัดค่า COF (Coefficient of Friction)", en: "COF (coefficient of friction) testers", zh: "摩擦系数（COF）测试仪" },
          { th: "เครื่องทดสอบแรงปิดผนึกและแรงลอก (Heat Seal / Peel)", en: "Heat seal and peel strength testers", zh: "热封及剥离强度测试仪" },
          { th: "เครื่องทดสอบแรงกระแทก (Dart Impact)", en: "Dart impact testers", zh: "落镖冲击试验机" },
          { th: "เครื่องทดสอบ Melt Flow Index (MFI)", en: "Melt flow index (MFI) testers", zh: "熔体流动速率（MFI）测试仪" },
          { th: "เครื่องวัดความหนืด (Viscometer)", en: "Viscometers", zh: "粘度计" },
          { th: "เครื่องวัดสีและความเงา", en: "Colorimeters and gloss meters", zh: "色差仪及光泽度计" },
          { th: "เครื่องวัดความแข็ง (Hardness Tester / Durometer)", en: "Hardness testers / durometers", zh: "硬度计" },
          { th: "เครื่องชั่งวิเคราะห์และเครื่องชั่งความละเอียดสูง", en: "Analytical and precision balances", zh: "分析天平及精密天平" },
          { th: "ตู้อบลมร้อนและตู้อบสุญญากาศ", en: "Laboratory and vacuum ovens", zh: "热风烘箱及真空烘箱" },
          { th: "เครื่องทดสอบการรั่วซึม (Leak Tester)", en: "Leak testers", zh: "密封（泄漏）测试仪" },
        ],
        list2Title: { th: "บริการที่มาพร้อมเครื่อง", en: "Included With Your Equipment", zh: "随设备提供的服务" },
        list2: [
          { th: "ให้คำปรึกษาเลือกรุ่นให้ตรงกับงานของคุณ", en: "Advice on the model that fits your work", zh: "根据您的用途提供选型建议" },
          { th: "ติดตั้งเครื่อง", en: "Installation", zh: "安装" },
          { th: "สอนการใช้งานให้ทีมงานของคุณ", en: "Training for your team", zh: "为您的团队提供操作培训" },
          { th: "ซ่อมบำรุงและสอบเทียบหลังการขาย", en: "After-sales maintenance and calibration", zh: "售后维修与校准" },
        ],
      },
      "calibration-repair": {
        title: {
          th: "ซ่อมบำรุงและสอบเทียบเครื่องมือวัด",
          en: "Maintenance, Repair & Calibration",
          zh: "仪器维修与校准",
        },
        metaDescription: {
          th: "บริการซ่อมบำรุง ดูแลรักษา และสอบเทียบเครื่องมือวัดและเครื่องทดสอบทุกประเภทตามมาตรฐานสากล โดยทีมวิศวกรผู้เชี่ยวชาญของโปรฟิน แล็บสเกล",
          en: "Maintenance, repair and calibration of all types of testing and measuring instruments to international standards, by Profin Lab Scale's engineers.",
          zh: "Profin Lab Scale 工程师团队按国际标准为各类测试与测量仪器提供维修、保养和校准服务。",
        },
        intro: {
          th: "บริการซ่อมบำรุง ดูแลรักษา และสอบเทียบเครื่องมือทดสอบทุกประเภท โดยทีมวิศวกรผู้เชี่ยวชาญ เพื่อให้เครื่องของคุณวัดค่าได้ถูกต้องและพร้อมใช้งานอยู่เสมอ",
          en: "Maintenance, repair and calibration for all types of testing equipment by expert engineers, so your instruments measure correctly and stay ready for use.",
          zh: "由专业工程师团队为各类测试设备提供维修、保养和校准服务，确保您的仪器测量准确、随时可用。",
        },
        listTitle: { th: "บริการของเรา", en: "Our Services", zh: "我们的服务" },
        list: [
          { th: "สอบเทียบเครื่องมือวัดและเครื่องทดสอบตามมาตรฐานสากล", en: "Calibration of measuring and testing instruments to international standards", zh: "按国际标准校准测量与测试仪器" },
          { th: "ซ่อมเครื่องทดสอบและเครื่องมือวัด", en: "Repair of testing and measuring instruments", zh: "测试与测量仪器维修" },
          { th: "ดูแลรักษาเครื่องให้พร้อมใช้งาน", en: "Maintenance to keep instruments ready for use", zh: "日常保养，确保仪器随时可用" },
          { th: "ให้คำแนะนำการใช้งานและการดูแลเครื่อง", en: "Advice on operating and caring for your instruments", zh: "提供仪器使用与保养建议" },
        ],
        list2Title: { th: "เครื่องที่ให้บริการ", en: "Instruments We Service", zh: "服务的仪器" },
        list2: [
          { th: "เครื่องทดสอบแรงดึง (Tensile Tester / UTM)", en: "Tensile testers / UTMs", zh: "拉力试验机 / 万能材料试验机" },
          { th: "เครื่องทดสอบฟิล์ม พลาสติก และบรรจุภัณฑ์", en: "Film, plastic and packaging testers", zh: "薄膜、塑料及包装测试仪" },
          { th: "เครื่องวัดค่า COF", en: "COF testers", zh: "摩擦系数测试仪" },
          { th: "เครื่องวัดความหนืด (Viscometer)", en: "Viscometers", zh: "粘度计" },
          { th: "เครื่องวัดสีและความเงา", en: "Colorimeters and gloss meters", zh: "色差仪及光泽度计" },
          { th: "เครื่องวัดความแข็ง", en: "Hardness testers", zh: "硬度计" },
          { th: "เครื่องชั่ง", en: "Balances", zh: "天平" },
          { th: "ตู้อบห้องแล็บ", en: "Laboratory ovens", zh: "实验室烘箱" },
        ],
      },
      "lab-design-construction": {
        title: {
          th: "ออกแบบและสร้างห้องปฏิบัติการ (Lab)",
          en: "Laboratory Design & Construction",
          zh: "实验室设计与建设",
        },
        metaDescription: {
          th: "ออกแบบและสร้างห้องปฏิบัติการมาตรฐานสากลสำหรับอุตสาหกรรม ทั้งห้อง QC และห้องแลปโรงงาน พร้อมจัดหาเครื่องมือทดสอบ ติดตั้ง และสอนการใช้งาน",
          en: "Design and construction of international-standard industrial laboratories and QC rooms, with the testing equipment, installation and training.",
          zh: "为工业客户设计和建设国际标准实验室及QC室，并提供测试设备、安装和培训。",
        },
        intro: {
          th: "ออกแบบและก่อสร้างห้องปฏิบัติการมาตรฐานสากลสำหรับอุตสาหกรรม ตั้งแต่ห้อง QC ไปจนถึงห้องแลปของโรงงาน พร้อมจัดหาเครื่องมือทดสอบ ติดตั้ง และสอนการใช้งาน ครบในที่เดียว",
          en: "Design and construction of international-standard laboratories for industry — from QC rooms to full factory labs — together with the testing equipment, installation and training, all from one supplier.",
          zh: "为工业客户设计和建设国际标准实验室——从QC室到工厂实验室——并一站式提供测试设备、安装和培训。",
        },
        listTitle: { th: "สิ่งที่เราทำ", en: "What We Do", zh: "服务内容" },
        list: [
          { th: "ออกแบบห้องแลปให้เหมาะกับงานทดสอบของคุณ", en: "Lab layouts designed around the tests you run", zh: "根据您的测试需求设计实验室" },
          { th: "ก่อสร้างห้องปฏิบัติการตามมาตรฐานสากล", en: "Construction to international standards", zh: "按国际标准施工建设" },
          { th: "จัดหาเครื่องมือวัดและเครื่องทดสอบ", en: "Supply of testing and measuring instruments", zh: "供应测试与测量仪器" },
          { th: "ติดตั้งและสอนการใช้งาน", en: "Installation and training", zh: "安装与培训" },
        ],
        list2Title: { th: "เหมาะสำหรับ", en: "Suited For", zh: "适用于" },
        list2: [
          { th: "ห้อง QC ในโรงงาน", en: "Factory QC rooms", zh: "工厂QC室" },
          { th: "ห้องปฏิบัติการทดสอบวัสดุ", en: "Materials testing laboratories", zh: "材料测试实验室" },
          { th: "ห้องทดสอบบรรจุภัณฑ์ ฟิล์ม และพลาสติก", en: "Packaging, film and plastics testing labs", zh: "包装、薄膜及塑料测试实验室" },
        ],
      },
    },
  },
} as const;

export type TranslationKey = keyof typeof translations;
