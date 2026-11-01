import Foundation
import Security

let arguments = CommandLine.arguments
guard arguments.count >= 4 else {
    exit(64)
}

let operation = arguments[1]
let service = arguments[2]
let account = arguments[3]

let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]

func itemExists() -> Bool {
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    switch status {
    case errSecSuccess:
        return true
    case errSecItemNotFound:
        return false
    default:
        exit(1)
    }
}

switch operation {
case "check":
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    switch status {
    case errSecSuccess:
        exit(0)
    case errSecItemNotFound:
        exit(1)
    default:
        exit(3)
    }

case "present":
    guard itemExists() else {
        exit(1)
    }

case "add":
    guard arguments.count == 4 else {
        exit(64)
    }
    if itemExists() {
        exit(2)
    }

    let value = String(
        data: FileHandle.standardInput.readDataToEndOfFile(),
        encoding: .utf8
    ) ?? ""
    guard !value.isEmpty else {
        exit(64)
    }

    var item = query
    item[kSecValueData as String] = Data(value.utf8)
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else {
        fputs("KEYCHAIN FAILED: operation=add status=\(status)\n", stderr)
        exit(1)
    }

case "delete":
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
        exit(1)
    }

case "update":
    guard arguments.count == 4 else {
        exit(64)
    }
    let value = String(
        data: FileHandle.standardInput.readDataToEndOfFile(),
        encoding: .utf8
    ) ?? ""
    guard !value.isEmpty else {
        exit(64)
    }
    let attributes: [String: Any] = [
        kSecValueData as String: Data(value.utf8)
    ]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    switch status {
    case errSecSuccess:
        exit(0)
    case errSecItemNotFound:
        exit(2)
    default:
        fputs("KEYCHAIN FAILED: operation=update status=\(status)\n", stderr)
        exit(1)
    }

default:
    exit(64)
}
