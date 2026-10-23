# Routine mode (development preview)

Open **Chores → Free time**. In **Settings → Family → Routine mode**, a parent picks a child, enables routine mode, and sets its start and free-time end times in the family's timezone. By default, all active chores assigned to that child and due today must
have approved completions. Pending parent approvals do not count. Shared chores are excluded;
a day without assigned chores is free until the cutoff. Undoing a completion re-locks apps at
the next successful check. Each new day uses that day's chores. Turning chores off also turns
routine mode off.

This first version has no points exchange, reading verification, parent override timer or daily
screen-time allowance. A parent can turn routine mode off. Existing timed chores and activity
chores can supply the requirements. Policies are opt-in and the migration does not alter existing
family data.

## iPhone and iPad setup

Use the matching kinwall-mobile routine-mode development build (iOS/iPadOS 17+). On the child's
physical device, temporarily sign into Kinwall with parent access, open Settings → Family → Routine mode, pick that child,
and choose apps. Apple requires parental authorization for a child in Family Sharing. Keep
Kinwall, school tools, communication and essential apps outside the selected apps/categories.
Then sign out and pair Kinwall to that child. App choices stay on that device as opaque Apple
tokens; they are never sent to Kinwall's server. Each device needs its own setup.

The native shell fetches the child's decision from the server rather than trusting completion or
unlock claims from the web page. It checks every 15 seconds while active and on return. A local
Device Activity monitor re-locks at the cutoff while Kinwall is closed. Unlocking after a parent
approves a chore currently requires opening Kinwall. Remote background delivery is not implemented.
Offline devices keep the last decision until its cutoff; changes made elsewhere take effect on
the next successful check. Revoked authorization and tamper resistance need physical-device QA.

The simulator exposes a clearly labeled preview and sample Games/Videos selection. The routine,
chores and approval screens work there, but simulator status is not proof of real app shielding
or Family Sharing authorization. The development demo uses fictional family data only.

Apple's Family Controls distribution approval is needed for both the main application and the
new `family.kinwall.app.routine-monitor` extension. The shared App Group is
`group.family.kinwall.routine`. Existing bundle identifiers and signing teams are unchanged.

## School access

A parent can choose **Only allowed websites** and list allowed hosts, one per line. For example,
`clever.com`, `www.clever.com` and `student.freckle.com`. Full HTTPS links are normalized to host
names; credentials, query strings, ports and wildcards are rejected. Up to 40 hosts can be saved.
When this option is on, routine mode filters other web browsing while keeping the listed sites
available. Schoolwork completion is still handled by chores and approvals, not browsing history.

In **Choose apps on this device**, use **Keep available** to select individual apps such as Safari,
the school browser and essential tools. These app exceptions win over both selected app blocks
and selected entertainment categories. Selecting a website cannot unblock a browser app; both
parts of setup matter. Kinwall keeps its connected server host available so its own web interface
is not caught by the school-only website filter. A separate parent-managed Screen Time policy
can still impose stricter restrictions.

Schools using Clever may redirect to Google, Microsoft or a district sign-in host. Add the actual
school login and resource hosts needed by your school rather than allowing all of google.com or
microsoft.com. The examples are starting points, not complete integration allowlists. Test real
school login and content on the child's physical device; simulator browsing is not filtered.
School access remains available after the evening cutoff under this policy. Turning routine mode
off or earning free time clears Kinwall's routine website filter.

In Settings, each allowed host has a **Show in website links** checkbox. Only checked hosts appear
on the child’s routine page; unchecked hosts remain permitted by the website filter. For example,
show Clever as the starting link and hide Freckle when school access must begin through Clever.
All links can be hidden without changing website permissions.

## Schedules

Each child has a separate schedule. Choose **Same times every day**, or **Customize by day**
and enable overrides for individual days. Days without overrides use the daily times. The start
must be earlier than the end on the same day; overnight windows are not supported.
Before the start, apps are available. From the start, approved chores unlock free time until
the end, when apps pause for the night. The family timezone determines the day and times.
A local monitor closes a grant at the start or end boundary. Open Kinwall to refresh the decision
at the start, including on days with no chores. Existing preview policies start at midnight
until a parent sets a later start.

Website access has two options: **Allow all websites** and **Only allowed websites**. Website
permissions come from these settings; the native app picker is for apps and categories.

## App choices

Each child can use **Pause selected apps and categories** or **Pause all apps except allowed apps**.
The native picker accepts both categories and individual apps in the first mode. Individual apps
in **Keep available** take priority over both selected apps and category restrictions in either
mode. In all-apps mode Apple automatically exempts Kinwall. When **Only allowed websites** is on,
select Safari or the school browser in **Keep available**; Apple does not let Kinwall identify
Safari automatically from the private picker tokens. Other Screen Time policies may still restrict it.

The browser demo includes a sample app picker and shows which apps would be paused by the saved
mode and current sample selections. Choices are separate per child, reset on reload, and do not
control actual apps. The iOS simulator also offers sample categories and allowed apps. Real app
selection and shielding still need a physical device; cross-device app-selection sync is not built yet.

## Required chores

In each child’s settings, choose **All assigned chores due today** (the default) or **Selected chores**.
The checklist includes all active chores assigned to that child, including recurring chores that
are not due today. Only selected chores due on the current household day count toward the routine.
Completions must be approved; pending approvals still wait for a grown-up. Other assigned chores
remain on the child’s chore list but do not prevent free time. Inactive, archived, deleted or
reassigned chores stop counting. Selecting no chores makes access depend on the schedule alone.
Shared chores cannot be selected.
