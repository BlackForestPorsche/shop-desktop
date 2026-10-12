pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.plasmoid
import org.kde.plasma.plasma5support as P5Support
import "ApiClient.js" as Api
import "SessionStore.js" as SessionStore

PlasmoidItem {
    id: root

    Plasmoid.configurationRequired: false
    Plasmoid.busy: busy
    toolTipMainText: Plasmoid.title
    toolTipSubText: statusLine

    preferredRepresentation: fullRepresentation
    compactRepresentation: compactRep
    fullRepresentation: fullRep

    property bool busy: false
    property string statusLine: i18n("Black Forest Shop")
    property string errorText: ""
    property var session: null
    property var viewPayload: null
    property string lastStamp: ""
    property string pendingSessionOp: ""
    property string sessionFingerprint: ""
    property bool shellUpdating: false
    property bool sendingNote: false
    property string noteStatusText: ""
    property int noteClearToken: 0
    property var deskPeople: ["logan", "stephen", "steve", "carla", "john"]

    readonly property string viewId: plasmoid.configuration.viewId || "lot"
    readonly property int pollMs: Math.max(30, plasmoid.configuration.pollSeconds || 60) * 1000
    readonly property var people: [
        "logan", "stephen", "steve", "carla", "john", "dwight", "viewer"
    ]
    readonly property bool isNotesView: viewId === "notes"
    readonly property bool canCreateNotes: {
        const role = session && session.role ? String(session.role).toLowerCase() : "";
        return role === "desk" || role === "bot";
    }

    function sessionHelper() {
        // Installed to ~/.local/bin by scripts/install-plasma-widget.sh
        return "blackforest-widget-session";
    }

    function setError(text) {
        errorText = text || "";
    }

    function fingerprintSession(next) {
        if (!next || !next.token) {
            return "";
        }
        return String(next.token.length) + ":" + String(next.expiresAt || "") + ":"
            + String(next.person || "") + ":" + String(next.role || "");
    }

    function clearSessionLocal() {
        session = null;
        viewPayload = null;
        lastStamp = "";
        noteStatusText = "";
        sessionFingerprint = "";
        pendingSessionOp = "clear";
        executable.exec(sessionHelper() + " clear");
    }

    function loadSessionFromDisk() {
        pendingSessionOp = "read";
        executable.exec(sessionHelper() + " read");
    }

    function syncSessionFromDisk() {
        // Lightweight cross-app sync (Electron / other widget instances).
        if (pendingSessionOp.length > 0 || busy || shellUpdating) {
            return;
        }
        pendingSessionOp = "sync";
        executable.exec(sessionHelper() + " read");
    }

    function saveSessionToDisk(next) {
        // Never log next.token
        pendingSessionOp = "write";
        const payload = JSON.stringify({
            token: next.token,
            expiresAt: next.expiresAt,
            person: next.person,
            role: next.role || "",
            loginAt: next.loginAt || new Date().toISOString()
        });
        executable.exec("bash -lc " + JSON.stringify(
            "printf '%s' " + JSON.stringify(payload) + " | " + sessionHelper() + " write"
        ));
    }

    function applySession(next) {
        session = next;
        sessionFingerprint = fingerprintSession(next);
        statusLine = next && next.person
            ? i18n("Signed in as %1", next.person)
            : i18n("Locked");
        if (next) {
            loadDeskPeople();
            refreshView();
        }
    }

    function handleAuthFailure(res) {
        if (!res) {
            setError(i18n("Couldn't reach the shop."));
            return;
        }
        if (res.status === 401) {
            clearSessionLocal();
            setError(i18n("Session expired. Unlock again."));
            return;
        }
        if (res.status === 403 && res.body && res.body.error === "pin_change_required") {
            setError(i18n("This person must set a PIN on the shop site first."));
            return;
        }
        if (res.status === 403) {
            setError(i18n("This view isn't available for your role."));
            return;
        }
        if (res.status === 429) {
            const wait = res.retryAfter ? i18n(" Try again in %1 seconds.", res.retryAfter) : "";
            setError(i18n("Too many tries.") + wait);
            return;
        }
        if (res.status === 404) {
            setError(i18n("Unknown view. Pick another in widget settings."));
            return;
        }
        setError(i18n("Shop answered %1.", String(res.status)));
    }

    function noteErrorMessage(res) {
        if (!res) {
            return i18n("Couldn't reach the shop.");
        }
        const code = res.body && res.body.error ? res.body.error : "";
        if (res.status === 401) {
            return i18n("Session expired. Unlock again.");
        }
        if (res.status === 403 && code === "pin_change_required") {
            return i18n("This person must set a PIN on the shop site first.");
        }
        if (res.status === 403) {
            return i18n("Your role can't leave notes.");
        }
        if (res.status === 400 && code === "bad_text") {
            return i18n("Note text is empty or too long (max 2000 characters).");
        }
        if (res.status === 400 && code === "bad_recipient") {
            return i18n("Pick a desk person to leave the note for.");
        }
        if (res.status === 429) {
            const wait = res.retryAfter || "60";
            return i18n("Too many notes. Try again in %1 seconds.", wait);
        }
        return i18n("Couldn't send the note (%1).", String(res.status));
    }

    function loadDeskPeople() {
        if (!session || !session.token) {
            return;
        }
        Api.listPeople(session.token).then(function (res) {
            if (res.status !== 200 || !res.body) {
                return;
            }
            var list = null;
            if (Array.isArray(res.body)) {
                list = res.body;
            } else if (Array.isArray(res.body.people)) {
                list = res.body.people;
            } else if (Array.isArray(res.body.items)) {
                list = res.body.items;
            }
            if (!list || !list.length) {
                return;
            }
            var ids = [];
            for (var i = 0; i < list.length; i++) {
                var row = list[i];
                var id = typeof row === "string" ? row : (row && (row.id || row.person || row.name));
                id = Api.normalizePerson(id);
                if (id && ids.indexOf(id) < 0) {
                    ids.push(id);
                }
            }
            if (ids.length) {
                deskPeople = ids;
            }
        }).catch(function () {
            // Keep DEFAULT_DESK_PEOPLE fallback.
        });
    }

    function sendNote(recipient, text) {
        if (!session || !session.token || sendingNote) {
            return;
        }
        const trimmed = String(text || "").trim();
        if (!trimmed) {
            setError(i18n("Write a short note first."));
            return;
        }
        if (!canCreateNotes) {
            setError(i18n("Your role can't leave notes."));
            return;
        }
        sendingNote = true;
        noteStatusText = "";
        setError("");
        maybeRefreshToken().then(function () {
            if (!session || !session.token) {
                sendingNote = false;
                return;
            }
            return Api.createNote(session.token, recipient, trimmed).then(function (res) {
                sendingNote = false;
                if (res.status !== 200 && res.status !== 201) {
                    if (res.status === 401) {
                        clearSessionLocal();
                    }
                    setError(noteErrorMessage(res));
                    return;
                }
                noteClearToken += 1;
                const who = res.body && res.body.recipient ? res.body.recipient : recipient;
                noteStatusText = i18n("Left a note for %1.", who);
                refreshView();
            });
        }).catch(function (err) {
            sendingNote = false;
            setError(err.message || i18n("Couldn't send the note."));
        });
    }

    function login(person, pin) {
        if (busy) {
            return;
        }
        busy = true;
        setError("");
        Api.login(person, pin).then(function (res) {
            busy = false;
            if (res.status !== 200 || !res.body || !res.body.token) {
                if (res.status === 401) {
                    setError(i18n("Wrong person or PIN."));
                    return;
                }
                handleAuthFailure(res);
                return;
            }
            const next = {
                token: res.body.token,
                expiresAt: res.body.expiresAt,
                person: res.body.person,
                role: res.body.role,
                loginAt: new Date().toISOString()
            };
            applySession(next);
            saveSessionToDisk(next);
        }).catch(function (err) {
            busy = false;
            setError(err.message || i18n("Login failed."));
        });
    }

    function logout() {
        if (!session || !session.token) {
            clearSessionLocal();
            statusLine = i18n("Locked");
            return;
        }
        const token = session.token;
        busy = true;
        Api.logout(token).finally(function () {
            busy = false;
            clearSessionLocal();
            statusLine = i18n("Locked");
            setError("");
        });
    }

    function maybeRefreshToken() {
        if (!SessionStore.shouldRefresh(session)) {
            return Promise.resolve(false);
        }
        return Api.refresh(session.token).then(function (res) {
            if (res.status !== 200 || !res.body || !res.body.token) {
                if (res.status === 401) {
                    clearSessionLocal();
                }
                return false;
            }
            const next = {
                token: res.body.token,
                expiresAt: res.body.expiresAt,
                person: res.body.person || session.person,
                role: res.body.role || session.role,
                loginAt: session.loginAt || new Date().toISOString()
            };
            session = next;
            sessionFingerprint = fingerprintSession(next);
            saveSessionToDisk(next);
            return true;
        }).catch(function () {
            return false;
        });
    }

    function updateShell() {
        if (shellUpdating) {
            return;
        }
        shellUpdating = true;
        setError("");
        statusLine = i18n("Updating shop widget…");
        pendingSessionOp = "shell-update";
        // Installed to ~/.local/bin by install-plasma / install-desk-automations.
        executable.exec("blackforest-refresh-widget --force");
    }

    function refreshView() {
        if (!session || !session.token) {
            return;
        }
        busy = true;
        setError("");
        maybeRefreshToken().then(function () {
            if (!session || !session.token) {
                busy = false;
                return;
            }
            return Api.fetchView(session.token, viewId).then(function (res) {
                busy = false;
                if (res.status !== 200 || !res.body) {
                    handleAuthFailure(res);
                    return;
                }
                viewPayload = res.body;
                lastStamp = res.body.stamp || "";
                statusLine = (res.body.title || viewId)
                    + (res.body.summary ? " · " + res.body.summary : "");
            });
        }).catch(function (err) {
            busy = false;
            setError(err.message || i18n("Couldn't load this view."));
        });
    }

    function openShop() {
        executable.exec("blackforest-tools || xdg-open https://shop.blackforestautomotive.com");
    }

    P5Support.DataSource {
        id: executable
        engine: "executable"
        connectedSources: []
        onNewData: function (source, data) {
            const out = data["stdout"] || "";
            const err = data["stderr"] || "";
            const code = data["exit code"];
            disconnectSource(source);

            if (pendingSessionOp === "read" || pendingSessionOp === "sync") {
                const wasSync = pendingSessionOp === "sync";
                pendingSessionOp = "";
                const parsed = SessionStore.parseSessionJson(out);
                if (code === 0 && parsed && !SessionStore.isExpired(parsed, 0)) {
                    const fp = fingerprintSession(parsed);
                    if (wasSync && fp === sessionFingerprint && !!session) {
                        return;
                    }
                    applySession(parsed);
                    return;
                }
                if (wasSync && !session) {
                    return;
                }
                if (session || !wasSync) {
                    session = null;
                    viewPayload = null;
                    lastStamp = "";
                    sessionFingerprint = "";
                    statusLine = i18n("Locked");
                }
                return;
            }

            if (pendingSessionOp === "shell-update") {
                pendingSessionOp = "";
                shellUpdating = false;
                if (code === 0) {
                    statusLine = i18n("Shop widget update finished");
                } else {
                    setError(i18n("Couldn't update the shop widget shell."));
                    statusLine = session && session.person
                        ? i18n("Signed in as %1", session.person)
                        : i18n("Black Forest Shop");
                }
                return;
            }

            if (pendingSessionOp === "write" || pendingSessionOp === "clear") {
                pendingSessionOp = "";
                if (code !== 0 && err) {
                    // Helper missing — keep in-memory session for this process only.
                    // Do not echo stderr if it could contain path noise; never log tokens.
                    console.warn("blackforest-widget-session failed (exit " + code + ")");
                }
            }
        }

        function exec(cmd) {
            connectSource(cmd);
        }
    }

    Timer {
        id: pollTimer
        interval: root.pollMs
        repeat: true
        running: !!root.session
        onTriggered: root.refreshView()
    }

    // Cross-surface session watch (Electron / other instances). Light read only — not an API poll.
    Timer {
        id: sessionWatchTimer
        interval: 12000
        repeat: true
        running: true
        onTriggered: root.syncSessionFromDisk()
    }

    Component.onCompleted: loadSessionFromDisk()

    onViewIdChanged: {
        noteStatusText = "";
        if (session) {
            if (isNotesView) {
                loadDeskPeople();
            }
            refreshView();
        }
    }

    Component {
        id: compactRep
        PlasmaComponents.ToolButton {
            icon.name: "view-calendar-agenda"
            text: root.viewPayload && root.viewPayload.summary
                ? root.viewPayload.summary
                : (root.session ? root.viewId : i18n("Unlock"))
            onClicked: root.expanded = !root.expanded
        }
    }

    Component {
        id: fullRep
        ColumnLayout {
            anchors.fill: parent
            spacing: Kirigami.Units.smallSpacing
            Layout.minimumWidth: Kirigami.Units.gridUnit * 16
            Layout.minimumHeight: Kirigami.Units.gridUnit * 18
            Layout.preferredWidth: Kirigami.Units.gridUnit * 20
            Layout.preferredHeight: Kirigami.Units.gridUnit * 24

            RowLayout {
                Layout.fillWidth: true
                Kirigami.Heading {
                    level: 3
                    text: root.viewPayload && root.viewPayload.title
                        ? root.viewPayload.title
                        : i18n("Black Forest Shop")
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                }
                PlasmaComponents.ToolButton {
                    icon.name: "view-refresh"
                    enabled: !!root.session && !root.busy && !root.shellUpdating
                    onClicked: root.refreshView()
                    PlasmaComponents.ToolTip {
                        text: i18n("Refresh view")
                    }
                }
                PlasmaComponents.ToolButton {
                    icon.name: "folder-sync"
                    enabled: !root.shellUpdating
                    onClicked: root.updateShell()
                    PlasmaComponents.ToolTip {
                        text: i18n("Update shop widget shell")
                    }
                }
                PlasmaComponents.ToolButton {
                    icon.name: "internet-web-browser"
                    onClicked: root.openShop()
                    PlasmaComponents.ToolTip {
                        text: i18n("Open shop tools")
                    }
                }
                PlasmaComponents.ToolButton {
                    icon.name: "system-lock-screen"
                    visible: !!root.session
                    onClicked: root.logout()
                    PlasmaComponents.ToolTip {
                        text: i18n("Lock widgets")
                    }
                }
            }

            PlasmaComponents.Label {
                Layout.fillWidth: true
                text: root.statusLine
                opacity: 0.8
                wrapMode: Text.WordWrap
            }

            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: root.errorText.length > 0
                text: root.errorText
                color: Kirigami.Theme.negativeTextColor
                wrapMode: Text.WordWrap
            }

            ColumnLayout {
                Layout.fillWidth: true
                visible: !root.session
                spacing: Kirigami.Units.smallSpacing

                PlasmaComponents.Label {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: i18n("Unlock with your shop person and PIN. Shared with every shop widget and Black Forest Tools on this computer.")
                }

                QQC2.ComboBox {
                    id: personBox
                    Layout.fillWidth: true
                    model: root.people
                }

                QQC2.TextField {
                    id: pinField
                    Layout.fillWidth: true
                    placeholderText: i18n("PIN")
                    echoMode: TextInput.Password
                    inputMethodHints: Qt.ImhDigitsOnly | Qt.ImhSensitiveData | Qt.ImhHiddenText
                    onAccepted: unlockButton.clicked()
                }

                PlasmaComponents.Button {
                    id: unlockButton
                    Layout.fillWidth: true
                    text: root.busy ? i18n("Checking…") : i18n("Unlock")
                    enabled: !root.busy && pinField.text.length > 0
                    onClicked: {
                        const person = personBox.currentText;
                        const pin = pinField.text;
                        pinField.text = "";
                        root.login(person, pin);
                    }
                }
            }

            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: !!root.session && !!root.viewPayload && !!root.viewPayload.summary
                text: root.viewPayload ? (root.viewPayload.summary || "") : ""
                font.bold: true
            }

            ColumnLayout {
                id: notesCompose
                Layout.fillWidth: true
                visible: !!root.session && root.isNotesView
                spacing: Kirigami.Units.smallSpacing

                PlasmaComponents.Label {
                    Layout.fillWidth: true
                    visible: !root.canCreateNotes
                    wrapMode: Text.WordWrap
                    text: i18n("This unlock can read notes. Desk or bot can leave a note for someone.")
                    opacity: 0.8
                }

                PlasmaComponents.Label {
                    Layout.fillWidth: true
                    visible: root.canCreateNotes
                    text: i18n("Leave a note for")
                }

                QQC2.ComboBox {
                    id: recipientBox
                    Layout.fillWidth: true
                    visible: root.canCreateNotes
                    model: root.deskPeople
                    enabled: !root.sendingNote
                    Component.onCompleted: {
                        const me = root.session && root.session.person
                            ? String(root.session.person).toLowerCase()
                            : "";
                        const idx = model.indexOf(me);
                        currentIndex = idx >= 0 ? idx : 0;
                    }
                }

                QQC2.TextArea {
                    id: noteField
                    Layout.fillWidth: true
                    Layout.preferredHeight: Kirigami.Units.gridUnit * 4
                    visible: root.canCreateNotes
                    wrapMode: TextEdit.Wrap
                    placeholderText: i18n("Keys are on the bench…")
                    enabled: !root.sendingNote

                    Connections {
                        target: root
                        function onNoteClearTokenChanged() {
                            noteField.text = "";
                        }
                    }
                }

                PlasmaComponents.Button {
                    id: sendNoteButton
                    Layout.fillWidth: true
                    visible: root.canCreateNotes
                    text: root.sendingNote ? i18n("Sending…") : i18n("Send note")
                    enabled: !root.sendingNote && !root.busy && noteField.text.trim().length > 0
                    onClicked: root.sendNote(recipientBox.currentText, noteField.text)
                }

                PlasmaComponents.Label {
                    Layout.fillWidth: true
                    visible: root.noteStatusText.length > 0
                    text: root.noteStatusText
                    wrapMode: Text.WordWrap
                    color: Kirigami.Theme.positiveTextColor
                }
            }

            ListView {
                id: list
                Layout.fillWidth: true
                Layout.fillHeight: true
                visible: !!root.session
                clip: true
                model: root.viewPayload && root.viewPayload.items ? root.viewPayload.items : []
                spacing: Kirigami.Units.smallSpacing

                delegate: ColumnLayout {
                    required property var modelData
                    width: list.width
                    spacing: 0

                    PlasmaComponents.Label {
                        Layout.fillWidth: true
                        text: modelData.label || ""
                        font.bold: true
                        elide: Text.ElideRight
                    }
                    PlasmaComponents.Label {
                        Layout.fillWidth: true
                        text: modelData.detail || ""
                        opacity: 0.9
                        wrapMode: Text.WordWrap
                    }
                    PlasmaComponents.Label {
                        Layout.fillWidth: true
                        text: modelData.meta || ""
                        opacity: 0.7
                        wrapMode: Text.WordWrap
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                    }
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.topMargin: Kirigami.Units.smallSpacing
                        height: 1
                        color: Kirigami.Theme.disabledTextColor
                        opacity: 0.25
                    }
                }

                PlasmaComponents.Label {
                    anchors.centerIn: parent
                    visible: list.count === 0 && !!root.session && !root.busy && !root.errorText
                    text: i18n("Nothing to show.")
                    opacity: 0.7
                }
            }

            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: !!root.session
                text: i18n("View: %1 · Configure widget to change", root.viewId)
                opacity: 0.6
                font.pointSize: Kirigami.Theme.smallFont.pointSize
            }
        }
    }
}
