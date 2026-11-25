// Trips and away days (docs/using/trips.md, docs/using/away.md; server: routes/trips.ts, routes/away.ts).
// Type-only, so the web app never imports the server's schemas. Every trip read is projected by the
// server for the device asking: booking details arrive only where this trip's setting allows them.

export type TripStatus = 'idea' | 'planning' | 'ready' // chosen by a grown-up; Underway and Past come from the dates
export type DetailsAudience = 'grownups' | 'everyone'
export type MarkKind = 'interested' | 'really'
export interface TripMark { memberId: string; kind: MarkKind }

export interface TripCounts { stops: number; stayGroups: number; staysChosen: number; staysBooked: number; legs: number; legsBooked: number; openVotes: number; planned: number; ideas: number }

export interface TripSummary {
  id: string; title: string; emoji: string | null; description: string | null; location: string | null
  startDate: string | null; endDate: string | null // YYYY-MM-DD; endDate is the last day (inclusive)
  dateNote: string | null // "Sometime in February": shown as written, never turned into dates
  status: TripStatus; archivedAt: string | null; canceledAt: string | null
  memberIds: string[] // who's going
  detailsAudience: DetailsAudience; detailsOnWall: boolean
  marks: TripMark[]
  counts: TripCounts
  revision: number; createdBy: string | null; createdAt?: string; updatedAt: string
  travelDay?: TravelDay // today on the trip, at the server's read; the web works it out again each minute (tripClock)
}

/** Which clock "today" on a trip follows: a grown-up's pick, the stop's or a leg's zone, or home's
 * when Kinwall can't tell (no zone set, stops overlapping, or between known places). */
export interface TravelDay { today: string; timeZone: string; source: 'override' | 'stop' | 'leg' | 'home'; stopId: string | null }

// ---- home and pet care -------------------------------------------------------------------------

export type CareKind = 'pet' | 'home' | 'plants' | 'other'
export type CareStatus = 'needed' | 'asked' | 'confirmed' | 'canceled'
export interface CareTask { id: string; text: string; done: boolean }
/** Who looks after the pets, plants or house while the family's away, on home calendar dates
 * (inclusive). The helper is just a name and how to reach them, never an account. Private. */
export interface CareArrangement {
  id: string; kind: CareKind; title: string
  helperName: string | null; helperContact: string | null
  fromDate: string | null; toDate: string | null
  status: CareStatus; tasks: CareTask[]
  instructions: string | null; entry: string | null; emergency: string | null
  sort: number; updatedAt: string
}
export type CareInput = Partial<Omit<CareArrangement, 'id' | 'updatedAt'>>

// ---- plan checks -------------------------------------------------------------------------------

/** Something in the plan worth a second look, never a blocker. Worded by the web from its code. */
export type PlanCheckCode = 'uncovered_nights' | 'overlapping_stays' | 'outside_trip' | 'travel_overlap' | 'travel_backwards'
export interface PlanCheck { code: PlanCheckCode; from: string | null; to: string | null; ids: string[]; part: 'stays' | 'travel' | 'stops' | 'plan'; count?: number }

export interface TripStop { id: string; label: string; town: string | null; timezone: string | null; arriveDate: string | null; leaveDate: string | null; notes: string | null; sort: number }

export type StayKind = 'hotel' | 'rental' | 'family' | 'camping' | 'other'
export type StayCost = 'unknown' | 'free' | 'contribution' | 'price' // unknown is never free
export type PriceBasis = 'night' | 'stay' | 'week' | 'person'
export interface StayPrice { amountMinor: number; currency: string; basis: PriceBasis | null; fees: 'included' | 'extra' | 'unknown'; observedOn: string | null; context?: string | null }
export interface StayDetails { address: string | null; contact: string | null; arrival: string | null; confirmation: string | null; manageUrl: string | null; codes: string | null }
export type StayBooking = 'none' | 'booked' | 'confirmed_family' | 'canceled'
export interface StayOption {
  id: string; groupId: string; kind: StayKind; name: string; town: string | null
  sourceUrl: string | null; siteName: string | null
  imageUrl: string | null // shown through api.stayImageUrl (the server fetches it), never loaded directly
  cost: StayCost; price: StayPrice | null; sleeps: number | null; notes: string | null
  booking: StayBooking; bookedBy: string | null; addedBy: string | null; fetchedAt: string | null
  details: StayDetails | null // null when this device may not see booking details
  hasDetails: boolean // there are some, even if hidden here ("🔒 For grown-ups")
}
export interface StayVote { memberId: string; optionId: string }
/** A stay vote. `options` maps each choice's poll option id (what PUT /api/polls/:id/vote takes) to
 * its place to stay; a vote's optionId may be either, so read it through stayOfVote (trips.ts). */
export interface StayPoll { id: string; status: 'open' | 'closed'; round?: number; votes: StayVote[]; voterIds: string[]; options?: { id: string; stayId: string }[] }
export interface StayGroup {
  id: string; stopId: string | null; label: string; checkIn: string | null; checkOut: string | null // checkOut: the morning you leave
  poll: StayPoll | null
  chosenOptionId: string | null; chosenBy: string | null; chosenAt: string | null; sort: number
  options: StayOption[]
}

export type LegMode = 'flight' | 'drive' | 'train' | 'bus' | 'ferry' | 'rental' | 'other'
export interface LegDetails { confirmation: string | null; manageUrl: string | null; notes: string | null }
export interface TripLeg {
  id: string; mode: LegMode; title: string | null; from: string | null; to: string | null
  departDate: string | null; departTime: string | null; departTz: string | null // the clock where it leaves, with that place's zone
  arriveDate: string | null; arriveTime: string | null; arriveTz: string | null
  carrier: string | null; number: string | null; memberIds: string[]
  booking: 'none' | 'booked' | 'canceled'; notes: string | null; sort: number
  details: LegDetails | null; hasDetails: boolean
}

export interface TripActivity { id: string; kind: 'activity'; title: string; date: string | null; time: string | null; tz?: string | null; place: string | null; url: string | null; notes: string | null; suggestedBy: string | null; marks: TripMark[]; sort: number }
export interface TripLinkItem { id: string; kind: 'outing' | 'meal' | 'event'; refId: string; label: string; date: string | null; time: string | null; missing: boolean; sort: number }
export type TripItem = TripActivity | TripLinkItem

/** pending: the calendar didn't answer clearly, so Kinwall won't add it again by itself (check the calendar). */
export interface CalendarLink { eventId: string | null; calendarId: string; state: 'added' | 'failed' | 'pending'; error: string | null }
export interface TripCalendar { span: CalendarLink | null; items: { kind: 'leg' | 'stay' | 'item'; id: string; link: CalendarLink }[] }

export interface Trip extends TripSummary {
  stops: TripStop[]; stayGroups: StayGroup[]; legs: TripLeg[]; items: TripItem[]
  packingListIds: string[] // Legacy API name: linked active lists of any kind.
  calendar: TripCalendar
  awayPeriodIds: string[]
  canSeeDetails: boolean
  can?: TripCan
  viewTimeZone?: string | null // a grown-up's pick for "Today" on the trip; null: from the stops and legs
  // Home and pet care: only for grown-ups' own devices (the server sends [] and false to anyone else).
  care?: CareArrangement[]; canSeeCare?: boolean; canEditCare?: boolean
  careUnavailable?: boolean // some care couldn't be decrypted here (its key changed); the rest is still in care
  checks?: PlanCheck[] // the server's answer for this device; tripCan() falls back to the device kind
}
export interface TripCan { edit: boolean; addStays: boolean; choose: boolean; suggest: boolean; vote: boolean }

export type TripInput = Partial<Pick<Trip, 'title' | 'emoji' | 'description' | 'location' | 'startDate' | 'endDate' | 'dateNote' | 'status' | 'memberIds' | 'detailsAudience' | 'detailsOnWall' | 'packingListIds' | 'archivedAt' | 'canceledAt' | 'viewTimeZone'>> & { revision?: number }
export type StopInput = Partial<Omit<TripStop, 'id'>>
export type StayGroupInput = Partial<Pick<StayGroup, 'stopId' | 'label' | 'checkIn' | 'checkOut' | 'sort'>>
export type StayOptionInput = Partial<Omit<StayOption, 'id' | 'groupId' | 'details' | 'hasDetails' | 'bookedBy' | 'addedBy'>> & { groupId?: string; details?: Partial<StayDetails> | null }
export type LegInput = Partial<Omit<TripLeg, 'id' | 'details' | 'hasDetails'>> & { details?: Partial<LegDetails> | null }
export type ActivityInput = Partial<Omit<TripActivity, 'id' | 'kind' | 'marks' | 'suggestedBy'>> & { kind?: 'activity' }
export type LinkInput = { kind: 'outing' | 'meal' | 'event'; refId: string; date?: string | null; time?: string | null }

/** What a public listing page says about itself (JSON-LD, Open Graph, Twitter card). Nothing is saved. */
export interface LinkPreview {
  ok: boolean; reason: 'blocked' | 'unreadable' | 'timeout' | null
  sourceUrl: string; finalUrl: string | null; siteName: string | null
  name: string | null; town: string | null; imageUrl: string | null
  price: StayPrice | null; sleeps: number | null; fetchedAt: string
}

export interface CalendarPublish { calendarId: string; span: boolean; legs: string[]; stays: string[]; items: string[] }

/** What else is tied to a trip's dates. Saving new dates changes only the trip; each of these is
 * then changed (or not) on its own, by a person. */
export interface DateChangeEntry { id: string; title?: string | null; label?: string | null; date?: string | null }
export interface DateChangePreview { away: DateChangeEntry[]; events: DateChangeEntry[]; meals: DateChangeEntry[]; bookedLegs: DateChangeEntry[]; bookedStays: DateChangeEntry[]; care?: DateChangeEntry[] } // care: grown-ups' full-access devices only

/** A record elsewhere that a trip links to or made (GET /api/trips/links): a linked meal or outing,
 * or a calendar event (linked, or added from the trip). Basic plans only. */
export interface TripLinkRef { kind: 'meal' | 'event' | 'outing'; refId: string; tripId: string; title: string; emoji: string | null }

// ---- away days ---------------------------------------------------------------------------------

export interface AwayPerson { memberId: string; startDate: string; endDate: string; leaveDayAway: boolean; returnDayAway: boolean }
export interface Handoff { id?: string; choreId: string; choreTitle?: string; choreEmoji?: string | null; fromMemberId: string; toMemberId: string; startDate: string; endDate: string }
export interface KeepDue { choreId: string; memberId: string }
export interface AwayPeriod {
  id: string; label: string; tripId: string | null; tripTitle: string | null
  people: AwayPerson[]; handoffs: Handoff[]; keepDue: KeepDue[]
  revision: number; createdBy: string | null; updatedAt: string
}
export type AwayInput = Pick<AwayPeriod, 'label' | 'tripId' | 'people' | 'handoffs' | 'keepDue'> & { revision?: number; token?: string }

/** One of an away person's chores in the review, with the days it covers. */
export interface AwayChoreLine { memberId: string; choreId: string; title: string; emoji: string | null; dates: string[]; toMemberId?: string | null; schoolwork?: boolean } // schoolwork pauses or stays due, never handed to someone else
export interface AwayNote { kind: string; text: string; blocking?: boolean; memberId?: string | null; choreId?: string | null }
export interface AwayReview {
  token: string
  paused: AwayChoreLine[]; handoffs: AwayChoreLine[]; keepDue: AwayChoreLine[]
  conflicts: AwayNote[] // blocking ones stop saving until they're fixed
  continues: AwayNote[]
}
