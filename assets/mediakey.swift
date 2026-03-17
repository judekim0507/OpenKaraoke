import Cocoa
import Foundation

let args = CommandLine.arguments

// Load MediaRemote framework
let mrBundle = Bundle(path: "/System/Library/PrivateFrameworks/MediaRemote.framework/")!
mrBundle.load()
let mrHandle = dlopen(mrBundle.executablePath!, RTLD_LAZY)

if args.count > 2 && args[1] == "seek" {
    let position = Double(args[2]) ?? 0

    // Try MRMediaRemoteSendCommand with kMRSeekToPlaybackPosition (command 45)
    typealias SendCommandFn = @convention(c) (UInt32, Optional<NSDictionary>) -> Bool
    if let sym = dlsym(mrHandle, "MRMediaRemoteSendCommand") {
        let fn = unsafeBitCast(sym, to: SendCommandFn.self)
        let options: NSDictionary = ["kMRMediaRemoteOptionPlaybackPosition": position]
        let _ = fn(45, options)
    }

    // Also try MRMediaRemoteSetElapsedTime as fallback
    typealias SetElapsedTimeFn = @convention(c) (Double) -> Void
    if let sym = dlsym(mrHandle, "MRMediaRemoteSetElapsedTime") {
        let fn = unsafeBitCast(sym, to: SetElapsedTimeFn.self)
        fn(position)
    }

    // Small delay to let the command propagate
    usleep(100000)
} else {
    // Send media key event (16=play/pause, 17=next, 18=prev)
    let key = Int(args.count > 1 ? args[1] : "16") ?? 16

    func sendKey(_ keyType: Int, down: Bool) {
        let flags = (keyType << 16) | ((down ? 0xa : 0xb) << 8)
        guard let event = NSEvent.otherEvent(
            with: .systemDefined, location: .zero,
            modifierFlags: NSEvent.ModifierFlags(rawValue: UInt(down ? 0xa00 : 0xb00)),
            timestamp: 0, windowNumber: 0, context: nil,
            subtype: 8, data1: flags, data2: -1
        ) else { exit(1) }
        if let cg = event.cgEvent { cg.post(tap: .cghidEventTap) }
    }

    sendKey(key, down: true)
    usleep(50000)
    sendKey(key, down: false)
}

if mrHandle != nil { dlclose(mrHandle) }
