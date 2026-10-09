import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM

KCM.SimpleKCM {
    property alias cfg_viewId: viewCombo.currentValue
    property alias cfg_pollSeconds: pollSpin.value

    Kirigami.FormLayout {
        QQC2.ComboBox {
            id: viewCombo
            Kirigami.FormData.label: i18n("View")
            textRole: "title"
            valueRole: "id"
            model: [
                { id: "lot", title: i18n("On the Lot") },
                { id: "book-today", title: i18n("Book — today") },
                { id: "notes", title: i18n("My open notes") }
            ]
            Component.onCompleted: {
                const idx = model.findIndex(function (row) { return row.id === plasmoid.configuration.viewId; });
                currentIndex = idx >= 0 ? idx : 0;
            }
        }

        QQC2.SpinBox {
            id: pollSpin
            Kirigami.FormData.label: i18n("Refresh every")
            from: 30
            to: 600
            stepSize: 15
            textFromValue: function (value) { return value + " " + i18n("seconds"); }
            valueFromText: function (text) { return parseInt(text, 10); }
        }

        QQC2.Label {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: i18n("Add this widget more than once and pick a different view on each copy. Unlock is shared across all copies.")
        }
    }
}
