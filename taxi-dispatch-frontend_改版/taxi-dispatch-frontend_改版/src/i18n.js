// src/i18n.js  (不能刪!!!)

const messages = {
  zh: {
    appTitle: 'SmartDispatch',
    language: '語言',
    passengerMode: '叫車',
    driverMode: '司機派遣',

    currentPassengerLabel: '目前乘客：',
    currentDriverLabel: '目前司機：',
    notLoggedIn: '尚未登入',
    driverPrefix: '司機：',
    passengerPrefix: '乘客：',

    backHome: '回首頁',
    startVehicleSim: '車輛模擬',
    stopVehicleSim: '停止模擬',

    pickupPlaceholder: '上車地點（例如：Times Square）',
    dropoffPlaceholder: '目的地（例如：Central Park）',

    stopLabel: '中途停靠點',
    stopPlaceholder: '輸入停靠地點',
    addStop: '＋ 新增停靠點',
    removeStop: '移除停靠點',

    viewPriceAndCars: '查看價格與車輛',
    estimatedDistancePrefix: '預估距離：約',
    distanceKmUnit: '公里',

    ordersTitlePassenger: '行程狀態',
    ordersTitleDriver: '推薦接單',
    refresh: '重新整理',
    loading: '更新中…',

    driverStatusLabel: '狀態：',
    driverStatusIdle: '待命',
    driverStatusBusy: '服務中',
    pickupMarkerTitle: '乘客上車點',
    dropoffMarkerTitle: '目的地',
    stopMarkerTitle: '停靠點',

    needPickupDropoff: '請輸入上車地點與目的地',
    needLoginPassenger: '請先以乘客身分登入',
    needLoginDriver: '請先以司機身分登入',
    needPriceFirst: '請先按「查看價格與車輛」',
    needCoordsPrepared: '座標尚未準備好，請再按一次「查看價格與車輛」',
    cannotFindPickupOrDropoff: '找不到上車地或目的地，請確認地址是否正確。',
    cannotFindStop: '找不到某個停靠點，請確認地址是否正確。',
    tripTooFar: '此行程無法成立，請重新輸入地點。',
    networkError: '目前無法連線到伺服器，請稍後再試。',
    cannotConnectServer: '目前無法連線到伺服器，請稍後再試。',
    createOrderFailed: '下單失敗，請稍後再試。',
    acceptOrderFailed: '接單失敗，請稍後再試。',
    attachDriverFailed: '無法建立司機車輛，請稍後再試。',
    driverVehicleNotAttached: '尚未綁定司機車輛，請重新登入司機或稍後再試。',

    // Auth
    authTitle: 'SmartDispatch 帳號',
    login: '登入',
    register: '註冊',
    registerNow: '立即註冊',
    usernameLabel: '帳號',
    passwordLabel: '密碼',
    usernamePlaceholder: '設定一個登入帳號',
    passwordPlaceholder: '至少 6 碼',
    roleLabel: '身分',
    rolePassenger: '乘客',
    roleDriver: '司機',
    carTypeLabel: '車輛種類',
    carTypeYellow: 'Yellow 計程車',
    carTypeGreen: 'Green 計程車',
    carTypeFhv: 'FHV（多元計程車）',
    selectCarTypeHint: '請選擇車輛種類',
    loginFailed: '登入失敗',
    registerFailed: '註冊失敗',

    // 舊 key 相容
    auth_loginFailed: '密碼錯誤！',
    auth_registerFailed: '此帳號名稱已被使用！',

    // Auth error mapping（照你指定的文字）
    // 1. 還沒註冊過 → 請先登入（你如果想改成「請先註冊」只要改這一行即可）
    errorUsernameTaken: '此帳號名稱已存在，請重新輸入',
    errorMissingFields: '請輸入完整的帳號與密碼。',
    errorUserNotFound: '請先註冊',
    errorWrongPassword: '密碼錯誤',

    // Landing page nav
    landingNavPassenger: '乘客叫車',
    landingNavDriver: '司機派遣',
    landingNavAuth: '登入 / 註冊',

    // Landing hero
    landingHeroTitle: 'SmartDispatch 智慧叫車',
    landingHeroSubtitle:
      '輸入目的地，系統即時整合需求預測、附近供給與距離，推薦更有效率的派遣結果。',
    landingHeroWhereTo: '去哪裡？',
    landingHeroPickupLabel: '上車地點',
    landingHeroPickupPlaceholder: '輸入上車地址',
    landingHeroPickupDefault: '目前位置',
    landingHeroDropoffLabel: '下車地點',
    landingHeroDropoffPlaceholder: '輸入目的地',
    landingHeroPriceExample: '預估金額：$150 - $180',
    landingHeroCta: '查看車種與價格',

    // Landing how-it-works
    landingHowTitleTag: 'Simple Steps',
    landingHowTitle: '如何使用 SmartDispatch？',
    landingHowSubtitle: '簡單三步驟，體驗 AI 賦能的紐約出行服務',
    landingHowStep1Title: '1. 設定目的地',
    landingHowStep1Desc:
      '輸入您的上車點與下車位置，系統將自動估算最佳路徑與透明報價。',
    landingHowStep2Title: '2. AI 智慧媒合',
    landingHowStep2Desc:
      '我們的 AI 演算法會在毫秒內分析全紐約路況，為您指派最快抵達的車輛。',
    landingHowStep3Title: '3. 安心抵達',
    landingHowStep3Desc:
      '即時追蹤司機位置，享受安全舒適的旅程，並在抵達後輕鬆支付。',
    landingHowCta: '立即開始叫車',

    // Landing driver section
    landingDriverBadge: '司機專屬',
    landingDriverTitleLine1: '有預測需求指數',
    landingDriverTitleLine2: '不讓你白跑一趟。',
    landingDriverIntro: '我們的 APP 內建 AI 預測分數系統：',
    landingDriverFeature1Title: ' 熱點預測地圖',
    landingDriverFeature1Desc:
      '地圖顏色深淺代表需求強度，直接導航至高分區域。',
    landingDriverFeature2Title: ' 獲利分數 (Score)',
    landingDriverFeature2Desc:
      '我們會為每條路線打分數，跟著高分走，空車率降低 30%。',
    landingDriverCta: '加入司機行列',

    // Landing footer
    landingFooterTitle: '立即體驗智慧派遣',
    landingFooterIos: '🍎 iOS 下載',
    landingFooterAndroid: '🤖 Android 下載',
    landingFooterCopyright:
      '© 2025 SmartDispatch Project. Department of Computer Science.',
      // OrderList (new)
ordersCountSuffix: '筆',
orderIdPrefix: '#',
orderPickupLabel: '上車',
orderDropoffLabel: '下車',
orderStopsLabel: '停靠點',
orderStopsExpand: '展開',
orderStopsCollapse: '收合',
orderStopsMore: '個更多',
orderDriverLabel: '司機',
orderDistanceLabel: '距離',
orderTimeLabel: '時間',
orderAccept: '接單',
orderAcceptDisabledHint: '請先登入/選擇司機',
orderEmpty: '目前沒有訂單',

// Order status (new, i18n-based)
orderStatus_pending: '等待派單',
orderStatus_assigned: '已指派',
orderStatus_accepted: '司機已接單',
orderStatus_en_route: '前往上車點',
orderStatus_in_progress: '行程中',
orderStatus_completed: '已完成',
orderStatus_cancelled: '已取消',
orderStatus_picked_up: '行程中',
orderStatus_ongoing: '行程中',

//儀表
replaySpeedTitle: '播放速度',
replaySpeedCurrent: '目前：',
traceLabel: '軌跡',
replayLabel: '重播',
sourceLabel: '來源：',
sumoLabel: 'SUMO',
physicsLabel: '物理模擬',
speedLabel: '速度：',
speedUnit: 'km/h',
timeShortLabel: '時間：',
timeSecondUnit: '秒',
expand: '展開',
collapse: '收合',

//司機乘客頁的
panelExpand: '展開',
panelCollapse: '收合',
pleaseLoginFirst: '請先登入',

driverSetInitialLocationHint: '⚠️ 請先在地圖上點擊一下，設定您的初始位置。',
driverResetLocationDebug: '重新設定司機位置',
recenter: '重新置中',

driverCompletedOrdersTitle: '已完成訂單',
driverCompletedTag: '已完成',
driverOrderPrefix: '訂單 #',
driverCompletedNoticePrefix: '此筆訂單已完成',
driverCompletedNoticePriceLabel: '金額：',
unknownValue: '未知',

addAnotherOrder: '新增另一張訂單',
driverArrivedPickupToast: '司機已抵達上車點',
orderCompletedThanksToast: '訂單已完成，感謝您的搭乘～',

//收合功能
landingBookingExpandBar: '展開叫車欄',
landingBookingCollapseBar: '收合叫車欄',
landingBookingExpandPanel: '展開叫車面板',
landingBookingCollapsePanel: '收合叫車面板',
logout: '登出',


  },

  en: {
    appTitle: 'SmartDispatch',
    language: 'Language',
    passengerMode: 'Passenger',
    driverMode: 'Driver',

    currentPassengerLabel: 'Passenger:',
    currentDriverLabel: 'Driver:',
    notLoggedIn: 'Not logged in',
    driverPrefix: 'Driver: ',
    passengerPrefix: 'Passenger: ',

    backHome: 'Home',
    startVehicleSim: 'Start vehicle simulation',
    stopVehicleSim: 'Stop vehicle simulation',

    pickupPlaceholder: 'Pickup (e.g., Times Square)',
    dropoffPlaceholder: 'Dropoff (e.g., Central Park)',

    stopLabel: 'Stop',
    stopPlaceholder: 'Enter stop location',
    addStop: '+ Add stop',
    removeStop: 'Remove stop',

    viewPriceAndCars: 'View prices & vehicles',
    estimatedDistancePrefix: 'Estimated distance:',
    distanceKmUnit: 'km',

    ordersTitlePassenger: 'My Orders',
    ordersTitleDriver: 'Pending Orders',
    refresh: 'Refresh',
    loading: 'Loading…',

    driverStatusLabel: 'Status: ',
    driverStatusIdle: 'Idle',
    driverStatusBusy: 'Busy',
    pickupMarkerTitle: 'Pickup',
    dropoffMarkerTitle: 'Dropoff',
    stopMarkerTitle: 'Stop',

    needPickupDropoff: 'Please enter pickup and dropoff locations.',
    needLoginPassenger: 'Please log in as a passenger first.',
    needLoginDriver: 'Please log in as a driver first.',
    needPriceFirst: 'Please click "View prices & vehicles" first.',
    needCoordsPrepared:
      'Coordinates not ready yet. Please click "View prices & vehicles" again.',
    cannotFindPickupOrDropoff:
      'Cannot find pickup or dropoff. Please check the addresses.',
    cannotFindStop:
      'Cannot find one of the stops. Please check the address.',
    tripTooFar: 'Trip is too long. Please choose closer locations.',
    networkError: 'Unable to connect to server. Please try again later.',
    cannotConnectServer:
      'Unable to connect to server. Please try again later.',
    createOrderFailed: 'Failed to create order. Please try again.',
    acceptOrderFailed: 'Failed to accept order. Please try again.',
    attachDriverFailed: 'Failed to create driver vehicle. Please try again.',
    driverVehicleNotAttached:
      'Driver vehicle is not attached yet. Please re-login as driver.',

    authTitle: 'SmartDispatch Account',
    login: 'Login',
    register: 'Register',
    registerNow: 'Sign up now',
    usernameLabel: 'Username',
    passwordLabel: 'Password',
    usernamePlaceholder: 'Choose a login name',
    passwordPlaceholder: 'At least 6 characters',
    roleLabel: 'Role',
    rolePassenger: 'Passenger',
    roleDriver: 'Driver',
    carTypeLabel: 'Vehicle type',
    carTypeYellow: 'Yellow Taxi',
    carTypeGreen: 'Green Taxi',
    carTypeFhv: 'FHV (For-hire vehicle)',
    selectCarTypeHint: 'Please select a vehicle type',
    loginFailed: 'Login failed',
    registerFailed: 'Registration failed',

    // legacy keys
    auth_loginFailed: 'Incorrect password!',
    auth_registerFailed: 'This username is already taken!',

    // Error mapping
    errorUsernameTaken: 'This username already exists. Please try again.',
    errorMissingFields: 'Please enter both username and password.',
    errorUserNotFound: 'Please sign up first.',
    errorWrongPassword: 'Wrong password.',

    landingNavPassenger: 'Ride',
    landingNavDriver: 'Drive',
    landingNavAuth: 'Login / Sign up',

    landingHeroTitle: 'SmartDispatch Taxi',
    landingHeroSubtitle:
      'Enter your destination and let demand prediction, nearby supply, and distance guide the best dispatch choice.',
    landingHeroWhereTo: 'Where to?',
    landingHeroPickupLabel: 'Pickup location',
    landingHeroPickupPlaceholder: 'Enter pickup address',
    landingHeroPickupDefault: 'Current location',
    landingHeroDropoffLabel: 'Dropoff location',
    landingHeroDropoffPlaceholder: 'Enter destination',
    landingHeroPriceExample: 'Estimated fare: $150 – $180',
    landingHeroCta: 'See vehicles and fares',

    landingHowTitleTag: 'Simple Steps',
    landingHowTitle: 'How to use SmartDispatch?',
    landingHowSubtitle:
      'Three simple steps to experience AI-powered New York rides.',

    landingHowStep1Title: '1. Set your destination',
    landingHowStep1Desc:
      'Enter pickup and dropoff, and we estimate the best route and transparent price.',
    landingHowStep2Title: '2. AI smart matching',
    landingHowStep2Desc:
      'Our algorithm analyzes NYC traffic in milliseconds and assigns the fastest driver.',
    landingHowStep3Title: '3. Arrive with peace of mind',
    landingHowStep3Desc:
      'Track your driver in real time, enjoy a safe trip, and pay effortlessly at arrival.',
    landingHowCta: 'Start booking now',

    landingDriverBadge: 'For drivers',
    landingDriverTitleLine1: 'Demand prediction score',
    landingDriverTitleLine2: 'No more wasted empty trips.',
    landingDriverIntro:
      'Our app includes an AI demand prediction scoring system:',
    landingDriverFeature1Title: ' Hotspot heatmap',
    landingDriverFeature1Desc:
      'Map colors represent demand strength, guiding you directly to high-score zones.',
    landingDriverFeature2Title: ' Profit score',
    landingDriverFeature2Desc:
      'We score every route. Follow high-score routes and cut empty miles by 30%.',
    landingDriverCta: 'Join as a driver',

    landingFooterTitle: 'Experience smart dispatch now',
    landingFooterIos: '🍎 Download for iOS',
    landingFooterAndroid: '🤖 Download for Android',
    landingFooterCopyright:
      '© 2025 SmartDispatch Project. Department of Computer Science.',
      ordersCountSuffix: 'orders',
orderIdPrefix: '#',
orderPickupLabel: 'Pickup',
orderDropoffLabel: 'Dropoff',
orderStopsLabel: 'Stops',
orderStopsExpand: 'Expand',
orderStopsCollapse: 'Collapse',
orderStopsMore: 'more',
orderDriverLabel: 'Driver',
orderDistanceLabel: 'Distance',
orderTimeLabel: 'Time',
orderAccept: 'Accept',
orderAcceptDisabledHint: 'Please log in / select a driver',
orderEmpty: 'No orders yet',

orderStatus_pending: 'Pending',
orderStatus_assigned: 'Assigned',
orderStatus_accepted: 'Accepted',
orderStatus_en_route: 'En route',
orderStatus_in_progress: 'In progress',
orderStatus_completed: 'Completed',
orderStatus_cancelled: 'Cancelled',
orderStatus_picked_up: 'On trip',
orderStatus_ongoing: 'On trip',

//儀表
replaySpeedTitle: 'Replay Speed',
replaySpeedCurrent: 'Current:',
traceLabel: 'TRACE',
replayLabel: 'REPLAY',
sourceLabel: 'Source:',
sumoLabel: 'SUMO',
physicsLabel: 'PHYSICS',
speedLabel: 'Speed:',
speedUnit: 'km/h',
timeShortLabel: 't:',
timeSecondUnit: 's',
expand: 'Expand',
collapse: 'Collapse',

//司機乘客頁的
panelExpand: 'Expand',
panelCollapse: 'Collapse',
pleaseLoginFirst: 'Please log in',

driverSetInitialLocationHint: '⚠️ Please click once on the map to set your initial location.',
driverResetLocationDebug: 'Reset driver location',
recenter: 'recenter',

driverCompletedOrdersTitle: 'Completed Orders',
driverCompletedTag: 'Completed',
driverOrderPrefix: 'Order #',
driverCompletedNoticePrefix: 'This order has been completed',
driverCompletedNoticePriceLabel: 'Amount: ',
unknownValue: 'Unknown',

addAnotherOrder: 'Create another order',
driverArrivedPickupToast: 'The driver has arrived at the pickup point.',
orderCompletedThanksToast: 'Your order is completed. Thank you for riding with us!',

//收合
landingBookingExpandBar: 'Expand booking form',
landingBookingCollapseBar: 'Collapse booking form',
landingBookingExpandPanel: 'Expand booking panel',
landingBookingCollapsePanel: 'Collapse booking panel',
logout: 'Log out',
  },

  ko: {
    appTitle: 'SmartDispatch',
    language: '언어',
    passengerMode: '승객 모드',
    driverMode: '기사 모드',

    currentPassengerLabel: '현재 승객:',
    currentDriverLabel: '현재 기사:',
    notLoggedIn: '로그인 안 됨',
    driverPrefix: '기사: ',
    passengerPrefix: '승객: ',

    backHome: '홈으로',
    startVehicleSim: '차량 시뮬레이션 시작',
    stopVehicleSim: '차량 시뮬레이션 중지',

    pickupPlaceholder: '승차 위치 (예: Times Square)',
    dropoffPlaceholder: '하차 위치 (예: Central Park)',

    stopLabel: '경유지',
    stopPlaceholder: '경유지 주소를 입력',
    addStop: '+ 경유지 추가',
    removeStop: '경유지 삭제',

    viewPriceAndCars: '요금 및 차량 보기',
    estimatedDistancePrefix: '예상 거리:',
    distanceKmUnit: 'km',

    ordersTitlePassenger: '내 주문',
    ordersTitleDriver: '대기 주문',
    refresh: '새로 고침',
    loading: '업데이트 중…',

    driverStatusLabel: '상태: ',
    driverStatusIdle: '대기',
    driverStatusBusy: '운행 중',
    pickupMarkerTitle: '승차 지점',
    dropoffMarkerTitle: '하차 지점',
    stopMarkerTitle: '경유지',

    needPickupDropoff: '승차 및 하차 위치를 입력하세요.',
    needLoginPassenger: '먼저 승객으로 로그인하세요.',
    needLoginDriver: '먼저 기사로 로그인하세요.',
    needPriceFirst: '"요금 및 차량 보기" 버튼을 먼저 누르세요.',
    needCoordsPrepared:
      '좌표가 아직 준비되지 않았습니다. 다시 시도하세요.',
    cannotFindPickupOrDropoff:
      '승차 또는 하차 위치를 찾을 수 없습니다.',
    cannotFindStop: '경유지 중 하나를 찾을 수 없습니다.',
    tripTooFar: '거리가 너무 멉니다. 다시 설정해 주세요.',
    networkError: '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.',
    cannotConnectServer:
      '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.',
    createOrderFailed: '주문 생성 실패. 다시 시도해 주세요.',
    acceptOrderFailed: '배차 수락 실패. 다시 시도해 주세요.',
    attachDriverFailed: '기사 차량을 생성할 수 없습니다.',
    driverVehicleNotAttached:
      '기사 차량이 아직 연결되지 않았습니다. 다시 로그인해 주세요.',

    authTitle: 'SmartDispatch 계정',
    login: '로그인',
    register: '회원가입',
    registerNow: '지금 가입',
    usernameLabel: '아이디',
    passwordLabel: '비밀번호',
    usernamePlaceholder: '로그인 아이디를 입력',
    passwordPlaceholder: '최소 6자',
    roleLabel: '역할',
    rolePassenger: '승객',
    roleDriver: '기사',
    carTypeLabel: '차량 종류',
    carTypeYellow: 'Yellow 택시',
    carTypeGreen: 'Green 택시',
    carTypeFhv: 'FHV (대절 차량)',
    selectCarTypeHint: '차량 종류를 선택하세요',
    loginFailed: '로그인 실패',
    registerFailed: '회원가입 실패',

    // legacy keys
    auth_loginFailed: '비밀번호가 잘못되었습니다!',
    auth_registerFailed: '이미 사용 중인 아이디입니다!',

    // errors
    errorUsernameTaken: '이미 존재하는 아이디입니다. 다시 입력해 주세요.',
    errorMissingFields: '아이디와 비밀번호를 모두 입력하세요.',
    errorUserNotFound: '먼저 회원가입해 주세요.',
    errorWrongPassword: '비밀번호가 올바르지 않습니다.',

    landingNavPassenger: '저는 승객입니다',
    landingNavDriver: '저는 기사입니다',
    landingNavAuth: '로그인 / 회원가입',

    landingHeroTitle: '택시 배차 시스템',
    landingHeroSubtitle:
      '데이터 분석으로 기다리는 시간을 줄여 드립니다.',
    landingHeroWhereTo: '어디로 가세요?',
    landingHeroPickupLabel: '승차 위치',
    landingHeroPickupPlaceholder: '승차 주소를 입력',
    landingHeroPickupDefault: '현재 위치',
    landingHeroDropoffLabel: '하차 위치',
    landingHeroDropoffPlaceholder: '목적지를 입력',
    landingHeroPriceExample: '예상 요금: $150 ~ $180',
    landingHeroCta: '요금 및 차량 보기',

    landingHowTitleTag: 'Simple Steps',
    landingHowTitle: 'SmartDispatch 사용 방법',
    landingHowSubtitle:
      '세 단계만으로 AI 기반 뉴욕 택시 서비스를 경험해 보세요.',

    landingHowStep1Title: '1. 목적지 설정',
    landingHowStep1Desc:
      '승차 지점과 하차 위치를 입력하면 최적 경로와 투명한 요금을 계산합니다.',
    landingHowStep2Title: '2. AI 스마트 배차',
    landingHowStep2Desc:
      'AI 알고리즘이 뉴욕 교통 상황을 분석해 가장 빨리 올 차량을 배차합니다.',
    landingHowStep3Title: '3. 안심 도착',
    landingHowStep3Desc:
      '실시간으로 기사 위치를 확인하며 안전하고 편안한 이동을 즐기세요.',
    landingHowCta: '지금 바로 호출하기',

    landingDriverBadge: '기사 전용',
    landingDriverTitleLine1: '수요 예측 지수로',
    landingDriverTitleLine2: '헛운행을 줄여 드립니다.',
    landingDriverIntro: '앱에는 AI 수요 예측 점수 시스템이 내장되어 있습니다:',
    landingDriverFeature1Title: ' 수요 핫스팟 지도',
    landingDriverFeature1Desc:
      '지도 색으로 수요 강도를 표시해 고수요 지역으로 바로 안내합니다.',
    landingDriverFeature2Title: ' 수익 점수 (Score)',
    landingDriverFeature2Desc:
      '각 노선에 점수를 매겨 높은 점수 위주로 운행하면 공차율이 30% 감소합니다.',
    landingDriverCta: '기사로 참여하기',

    landingFooterTitle: '지금 바로 스마트 배차를 경험해 보세요',
    landingFooterIos: '🍎 iOS 다운로드',
    landingFooterAndroid: '🤖 Android 다운로드',
    landingFooterCopyright:
      '© 2025 SmartDispatch Project. Department of Computer Science.',
      ordersCountSuffix: '건',
orderIdPrefix: '#',
orderPickupLabel: '승차',
orderDropoffLabel: '하차',
orderStopsLabel: '경유지',
orderStopsExpand: '펼치기',
orderStopsCollapse: '접기',
orderStopsMore: '개 더보기',
orderDriverLabel: '기사',
orderDistanceLabel: '거리',
orderTimeLabel: '시간',
orderAccept: '수락',
orderAcceptDisabledHint: '먼저 로그인/기사 선택',
orderEmpty: '주문이 없습니다',

orderStatus_pending: '대기',
orderStatus_assigned: '배정됨',
orderStatus_accepted: '수락됨',
orderStatus_en_route: '승차 지점으로 이동 중',
orderStatus_in_progress: '운행 중',
orderStatus_completed: '완료',
orderStatus_cancelled: '취소됨',
orderStatus_picked_up: '운행 중',
orderStatus_ongoing: '운행 중',

//儀表
replaySpeedTitle: '재생 속도',
replaySpeedCurrent: '현재:',
traceLabel: '트레이스',
replayLabel: '재생',
sourceLabel: '출처:',
sumoLabel: 'SUMO',
physicsLabel: '물리 시뮬레이션',
speedLabel: '속도:',
speedUnit: 'km/h',
timeShortLabel: '시간:',
timeSecondUnit: '초',
expand: '펼치기',
collapse: '접기',

//司機乘客頁的
panelExpand: '펼치기',
panelCollapse: '접기',
pleaseLoginFirst: '로그인 해주세요',

driverSetInitialLocationHint: '⚠️ 지도에서 한 번 클릭하여 초기 위치를 설정하세요.',
driverResetLocationDebug: '기사 위치 재설정',
recenter: '다시 가운데로',

driverCompletedOrdersTitle: '완료된 주문',
driverCompletedTag: '완료',
driverOrderPrefix: '주문 #',
driverCompletedNoticePrefix: '이 주문이 완료되었습니다',
driverCompletedNoticePriceLabel: '금액: ',
unknownValue: '알 수 없음',

addAnotherOrder: '다른 주문 추가',
driverArrivedPickupToast: '기사가 픽업 지점에 도착했습니다.',
orderCompletedThanksToast: '주문이 완료되었습니다. 이용해 주셔서 감사합니다!',

//收合
landingBookingExpandBar: '배차 입력창 펼치기',
landingBookingCollapseBar: '배차 입력창 접기',
landingBookingExpandPanel: '배차 패널 펼치기',
landingBookingCollapsePanel: '배차 패널 접기',
logout: '로그아웃',
  },

  ja: {
    appTitle: 'SmartDispatch',
    language: '言語',
    passengerMode: '乗客モード',
    driverMode: 'ドライバーモード',

    currentPassengerLabel: '現在の乗客：',
    currentDriverLabel: '現在のドライバー：',
    notLoggedIn: '未ログイン',
    driverPrefix: 'ドライバー：',
    passengerPrefix: '乗客：',

    backHome: 'ホームへ戻る',
    startVehicleSim: '車両シミュレーション開始',
    stopVehicleSim: '車両シミュレーション停止',

    pickupPlaceholder: '乗車場所（例：Times Square）',
    dropoffPlaceholder: '降車場所（例：Central Park）',

    stopLabel: '経由地',
    stopPlaceholder: '経由地を入力',
    addStop: '＋ 経由地を追加',
    removeStop: '経由地を削除',

    viewPriceAndCars: '料金と車両を表示',
    estimatedDistancePrefix: '推定距離：',
    distanceKmUnit: 'km',

    ordersTitlePassenger: '自分の注文',
    ordersTitleDriver: '待機中の注文',
    refresh: '更新',
    loading: '更新中…',

    driverStatusLabel: '状態：',
    driverStatusIdle: '待機',
    driverStatusBusy: '走行中',
    pickupMarkerTitle: '乗車地点',
    dropoffMarkerTitle: '降車地点',
    stopMarkerTitle: '経由地',

    needPickupDropoff: '乗車場所と降車場所を入力してください。',
    needLoginPassenger:
      'まず乗客としてログインしてください。',
    needLoginDriver:
      'まずドライバーとしてログインしてください。',
    needPriceFirst:
      '先に「料金と車両を表示」を押してください。',
    needCoordsPrepared:
      '座標がまだ準備できていません。もう一度試してください。',
    cannotFindPickupOrDropoff:
      '乗車または降車場所が見つかりません。住所を確認してください。',
    cannotFindStop:
      '経由地のいずれかが見つかりません。住所を確認してください。',
    tripTooFar: '距離が長すぎます。別の場所を選んでください。',
    networkError:
      'サーバーに接続できません。しばらくしてから再度お試しください。',
    cannotConnectServer:
      'サーバーに接続できません。後でもう一度お試しください。',
    createOrderFailed: '注文の作成に失敗しました。',
    acceptOrderFailed: '注文の受諾に失敗しました。',
    attachDriverFailed: 'ドライバー車両を作成できません。',
    driverVehicleNotAttached:
      'ドライバー車両がまだ紐付いていません。再ログインしてください。',

    authTitle: 'SmartDispatch アカウント',
    login: 'ログイン',
    register: '登録',
    registerNow: '今すぐ登録',
    usernameLabel: 'アカウント',
    passwordLabel: 'パスワード',
    usernamePlaceholder: 'ログイン名を設定',
    passwordPlaceholder: '6文字以上',
    roleLabel: '役割',
    rolePassenger: '乗客',
    roleDriver: 'ドライバー',
    carTypeLabel: '車種',
    carTypeYellow: 'Yellow タクシー',
    carTypeGreen: 'Green タクシー',
    carTypeFhv: 'FHV（ハイヤー）',
    selectCarTypeHint: '車種を選択してください',
    loginFailed: 'ログイン失敗',
    registerFailed: '登録失敗',

    // legacy keys
    auth_loginFailed: 'パスワードが正しくありません！',
    auth_registerFailed: 'このアカウント名は既に使用されています！',

    // errors
    errorUsernameTaken:
      'このアカウント名は既に存在します。再入力してください。',
    errorMissingFields: 'アカウントとパスワードを入力してください。',
    errorUserNotFound: 'まず登録してください。',
    errorWrongPassword: 'パスワードが違います。',

    landingNavPassenger: '乗客として利用',
    landingNavDriver: 'ドライバーとして利用',
    landingNavAuth: 'ログイン / 登録',

    landingHeroTitle: 'タクシー配車システム',
    landingHeroSubtitle:
      'データ分析で、待ち時間を無駄にしない移動体験を。',
    landingHeroWhereTo: 'どこへ行きますか？',
    landingHeroPickupLabel: '乗車場所',
    landingHeroPickupPlaceholder: '乗車場所を入力',
    landingHeroPickupDefault: '現在地',
    landingHeroDropoffLabel: '降車場所',
    landingHeroDropoffPlaceholder: '目的地を入力',
    landingHeroPriceExample: '推定料金：$150 ～ $180',
    landingHeroCta: '料金と車両を表示',

    landingHowTitleTag: 'Simple Steps',
    landingHowTitle: 'SmartDispatch の使い方',
    landingHowSubtitle: '3 ステップで AI 配車サービスを体験できます。',

    landingHowStep1Title: '1. 行き先を設定',
    landingHowStep1Desc:
      '乗車地点と降車地点を入力すると、最適ルートと料金を自動計算します。',
    landingHowStep2Title: '2. AI スマート配車',
    landingHowStep2Desc:
      'AI アルゴリズムがニューヨーク全体の交通を解析し、最速で到着できる車を配車します。',
    landingHowStep3Title: '3. 安心して到着',
    landingHowStep3Desc:
      'ドライバーの位置をリアルタイムで追跡し、安全で快適な移動をお楽しみください。',
    landingHowCta: '今すぐ配車を依頼',

    landingDriverBadge: 'ドライバー向け',
    landingDriverTitleLine1: '需要予測スコアで',
    landingDriverTitleLine2: 'ムダな空車走行を削減。',
    landingDriverIntro: 'アプリには AI 需要予測スコア機能を搭載：',
    landingDriverFeature1Title: ' ホットスポットマップ',
    landingDriverFeature1Desc:
      '地図の色で需要の強さを可視化し、稼げるエリアへ直接ナビします。',
    landingDriverFeature2Title: ' 収益スコア (Score)',
    landingDriverFeature2Desc:
      '各ルートにスコアを付け、高スコアのルートを走ることで空車率を 30% 削減します。',
    landingDriverCta: 'ドライバーとして参加',

    landingFooterTitle: 'スマート配車を今すぐ体験',
    landingFooterIos: '🍎 iOS ダウンロード',
    landingFooterAndroid: '🤖 Android ダウンロード',
    landingFooterCopyright:
      '© 2025 SmartDispatch Project. Department of Computer Science.',
      ordersCountSuffix: '件',
orderIdPrefix: '#',
orderPickupLabel: '乗車',
orderDropoffLabel: '降車',
orderStopsLabel: '経由地',
orderStopsExpand: '展開',
orderStopsCollapse: '折りたたむ',
orderStopsMore: '件の追加',
orderDriverLabel: 'ドライバー',
orderDistanceLabel: '距離',
orderTimeLabel: '時間',
orderAccept: '受諾',
orderAcceptDisabledHint: '先にログイン/ドライバー選択',
orderEmpty: '注文がありません',

orderStatus_pending: '待機',
orderStatus_assigned: '割り当て済み',
orderStatus_accepted: '受諾済み',
orderStatus_en_route: '迎えに向かっています',
orderStatus_in_progress: '走行中',
orderStatus_completed: '完了',
orderStatus_cancelled: 'キャンセル',
orderStatus_picked_up: '走行中',
orderStatus_ongoing: '走行中',

//儀表
replaySpeedTitle: '再生速度',
replaySpeedCurrent: '現在：',
traceLabel: '軌跡',
replayLabel: '再生',
sourceLabel: 'ソース：',
sumoLabel: 'SUMO',
physicsLabel: '物理シミュレーション',
speedLabel: '速度：',
speedUnit: 'km/h',
timeShortLabel: '時間：',
timeSecondUnit: '秒',
expand: '展開',
collapse: '折りたたむ',

//司機乘客頁的
panelExpand: '展開',
panelCollapse: '折りたたむ',
pleaseLoginFirst: 'ログインしてください',

driverSetInitialLocationHint: '⚠️ 地図を一度クリックして初期位置を設定してください。',
driverResetLocationDebug: 'ドライバー位置をリセット',
recenter: '中央に戻す',

driverCompletedOrdersTitle: '完了した注文',
driverCompletedTag: '完了',
driverOrderPrefix: '注文 #',
driverCompletedNoticePrefix: 'この注文は完了しました',
driverCompletedNoticePriceLabel: '金額：',
unknownValue: '不明',

addAnotherOrder: '別の注文を追加',
driverArrivedPickupToast: 'ドライバーが乗車地点に到着しました。',
orderCompletedThanksToast: '注文が完了しました。ご利用ありがとうございました！',

//收合
landingBookingExpandBar: '配車欄を展開',
landingBookingCollapseBar: '配車欄を折りたたむ',
landingBookingExpandPanel: '配車パネルを展開',
landingBookingCollapsePanel: '配車パネルを折りたたむ',
logout: 'ログアウト',
  },
}

export const languages = Object.keys(messages)

export function t(lang, key) {
  const langCode = messages[lang] ? lang : 'zh'
  return messages[langCode][key] ?? messages.zh[key] ?? key
}

