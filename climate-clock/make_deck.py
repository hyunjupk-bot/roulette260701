from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
BG=RGBColor(0x0B,0x1F,0x2A); CARD=RGBColor(0x14,0x33,0x44); BLUE=RGBColor(0x5B,0xB8,0xE0); RED=RGBColor(0xE8,0x19,0x1F); WHITE=RGBColor(255,255,255); GRAY=RGBColor(0xB8,0xC7,0xD1)
F='Noto Sans KR'
p=Presentation(); p.slide_width=Inches(10); p.slide_height=Inches(5.625)
blank=p.slide_layouts[6]
TOP=0.85  # 기후시계 띠(50pt) 아래 여백
def bg(s):
    s.background.fill.solid(); s.background.fill.fore_color.rgb=BG
def tb(s,x,y,w,h,text,size,color=WHITE,bold=False,align=PP_ALIGN.LEFT,anchor=MSO_ANCHOR.TOP):
    t=s.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h)); tf=t.text_frame; tf.word_wrap=True; tf.vertical_anchor=anchor
    lines=text if isinstance(text,list) else [text]
    for i,l in enumerate(lines):
        para=tf.paragraphs[0] if i==0 else tf.add_paragraph()
        para.alignment=align; r=para.add_run(); r.text=l; r.font.size=Pt(size); r.font.bold=bold; r.font.color.rgb=color; r.font.name=F
        if i: para.space_before=Pt(6)
    return t
def title(s,t,sub=None):
    bar=s.shapes.add_shape(MSO_SHAPE.RECTANGLE,Inches(0.5),Inches(TOP+0.08),Inches(0.08),Inches(0.5)); bar.fill.solid(); bar.fill.fore_color.rgb=RED; bar.line.fill.background()
    tb(s,0.7,TOP,8.8,0.65,t,26,WHITE,True,anchor=MSO_ANCHOR.MIDDLE)
    if sub: tb(s,0.7,TOP+0.62,8.8,0.4,sub,13,GRAY)
def card(s,x,y,w,h,head,body,accent=BLUE):
    c=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(x),Inches(y),Inches(w),Inches(h)); c.adjustments[0]=0.06
    c.fill.solid(); c.fill.fore_color.rgb=CARD; c.line.fill.background()
    tb(s,x+0.15,y+0.1,w-0.3,0.45,head,16,accent,True)
    tb(s,x+0.15,y+0.55,w-0.3,h-0.6,body,15,WHITE)
def slide(t,sub=None):
    s=p.slides.add_slide(blank); bg(s); title(s,t,sub) if t else None; return s
def cards(s,items,cols,y0=2.0,h=1.55,accent=BLUE):
    n=len(items); rows=(n+cols-1)//cols; w=(9.0-0.2*(cols-1))/cols
    for i,(hd,bd) in enumerate(items):
        r,c=divmod(i,cols); card(s,0.5+c*(w+0.2),y0+r*(h+0.2),w,h,hd,bd,accent)

# 1 표지
s=slide(None)
tb(s,0.8,1.5,8.4,1.2,"기후위기와 우리의 행동",44,WHITE,True)
tb(s,0.8,2.8,8.4,0.6,"시계는 멈추지 않습니다. 행동은 지금 시작할 수 있습니다.",20,BLUE)
tb(s,0.8,4.6,8.4,0.4,"#적시에행동하세요",14,GRAY)
# 2 오늘의 질문
s=slide("오늘의 질문","화면 맨 위의 시계를 먼저 봐주세요")
cards(s,[("사선 (빨간 시계)","지구 온난화를 1.5℃로 제한할 수 있는 시간이 얼마나 남았는지 보여줍니다."),("생명선 (파란 시계)","전 세계 에너지 중 재생에너지가 차지하는 비율이 얼마나 늘고 있는지 보여줍니다."),("오늘의 질문","우리는 이 시간 안에 무엇을 바꿀 수 있을까요?")],3,y0=2.2,h=2.4)
# 3 기후시계란
s=slide("기후시계란?","2015년 파리협정이 내건 목표를 숫자로 보여주는 시계")
cards(s,[("무엇을 보여주나","현재 배출 추세가 계속될 때 1.5℃ 한계에 도달하는 시점까지 남은 시간"),("왜 1.5℃인가","그 선을 넘으면 폭염·가뭄·해수면 상승 등 되돌리기 어려운 피해가 급격히 커집니다."),("어떻게 쓰나","뉴욕 유니언스퀘어 등 세계 곳곳에 설치되어 행동을 재촉하는 '계기판'입니다.")],3,y0=2.1,h=2.5)
# 4 현황
s=slide("지금 어디까지 왔나","과학이 말하는 현재 상황")
cards(s,[("기온","지구 평균기온은 산업화 이전보다 이미 약 1.2℃ 이상 올랐습니다."),("온실가스","대기 중 이산화탄소 농도는 관측 이래 최고 수준을 매년 경신하고 있습니다."),("바다","해수면과 해수 온도가 오르며 해안 지역과 산호초가 위협받고 있습니다."),("극한 기상","폭염, 집중호우, 산불이 더 잦고 더 강해지고 있습니다.")],2,y0=2.0,h=1.5)
# 5 원인
s=slide("원인은 무엇일까","온실가스는 어디에서 나올까")
cards(s,[("에너지","석탄·석유·가스 사용. 온실가스 배출의 약 4분의 3을 차지합니다."),("산업·건물","철강·시멘트 생산, 냉난방과 전기 사용"),("수송","자동차, 항공, 선박"),("토지·식량","산림 파괴와 농축산업")],4,y0=2.1,h=2.4)
# 6 영향
s=slide("우리 삶에 미치는 영향","먼 미래가 아니라 지금 이야기입니다")
cards(s,[("건강","폭염과 대기오염, 감염병 확산"),("식량·물","작황 변동, 가뭄과 홍수로 인한 물 부족"),("생태계","서식지 변화와 생물다양성 감소"),("경제·주거","재난 피해 증가, 기후 이주 확대")],2,y0=2.0,h=1.5,accent=RED)
# 7 희망
s=slide("희망의 신호","파란 시계가 보여주는 변화")
cards(s,[("재생에너지 성장","태양광·풍력은 빠르게 보급되며 발전 단가가 크게 내려갔습니다."),("전기차 확대","유럽 등에서 전기차 판매가 꾸준히 늘고 있습니다."),("자연 복원","해안선·숲·습지 복원이 탄소 흡수와 재해 완충에 기여합니다.")],3,y0=2.1,h=2.5)
# 8 개인
s=slide("나의 행동: 일상에서","작지만 모이면 큽니다")
cards(s,[("이동","대중교통·자전거·걷기, 가까운 거리는 차 없이"),("에너지","고효율 가전, 불필요한 전력 줄이기, 재생에너지 요금제"),("먹거리","잔반 줄이기, 제철·지역 식재료, 식물성 식단 늘리기"),("소비","오래 쓰고 고쳐 쓰기, 중고 활용, 재활용 분리배출")],2,y0=2.0,h=1.5)
# 9 공동체
s=slide("우리의 행동: 학교·직장·지역에서","함께하면 규모가 달라집니다")
cards(s,[("학교·직장","탄소 줄이기 캠페인, 에너지 절약 챌린지, 친환경 구매 기준 만들기"),("지역사회","시민 에너지 협동조합, 나무 심기, 동네 자원순환 활동"),("함께 배우기","기후 교육과 토론, 기후시계 같은 자료 공유하기")],3,y0=2.1,h=2.5)
# 10 정책
s=slide("목소리 내기","개인의 선택과 제도의 변화는 함께 가야 합니다")
cards(s,[("투표와 참여","기후 공약을 확인하고 투표하며 의견을 전달합니다."),("기업에 요구","친환경 제품과 투명한 탄소 공개를 요구합니다."),("연대","환경 단체와 시민 모임에 참여하고 후원합니다.")],3,y0=2.1,h=2.5)
# 11 서약
s=slide("오늘의 실천 약속","이번 주에 할 한 가지를 정해봅시다")
cards(s,[("1","이번 주 이동 방법 하나 바꾸기"),("2","집·교실·사무실에서 전기 낭비 하나 줄이기"),("3","주변 사람 한 명에게 기후시계 알리기")],3,y0=2.1,h=2.3,accent=RED)
# 12 마무리
s=slide(None)
tb(s,0.8,1.7,8.4,1.0,"시간은 가고 있지만,",32,WHITE,True)
tb(s,0.8,2.5,8.4,1.0,"방향은 우리가 바꿀 수 있습니다.",32,BLUE,True)
tb(s,0.8,4.4,8.4,0.5,"#적시에행동하세요   |   climateclock.world",16,GRAY)
p.save('climate.pptx')
